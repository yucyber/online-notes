import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { AiGatewayClient } from './ai-gateway.client'
import { AiChatRoute, AiMermaidInput, AiMindmapInput, AiPetInput, AiWorkflowContext, AiWriterInput } from './ai-gateway.types'
import { AiRunService } from './ai-run.service'
import { AggregateSummaryGraph } from './graphs/aggregate-summary.graph'
import { KnowledgeGraphBuildGraph } from './graphs/knowledge-graph-build.graph'
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly gateway: AiGatewayClient,
    private readonly knowledgeBases: KnowledgeBasesService,
    @Optional() private readonly aiRuns?: AiRunService,
    @Optional() private readonly aggregateSummaryGraph?: AggregateSummaryGraph,
    @Optional() private readonly knowledgeGraphBuildGraph?: KnowledgeGraphBuildGraph,
  ) {}

  async generateSummary(content: string): Promise<string> {
    const cleanContent = this.cleanText(content).slice(0, 3000)
    if (!cleanContent) return ''

    try {
      return await this.gateway.chat({
        route: 'text',
        system: 'You summarize notes for a knowledge management app. Return only the summary.',
        prompt: `Summarize the following note in Chinese within 120 Chinese characters. Keep the core facts and avoid prefaces.\n\n${cleanContent}`,
        maxTokens: 256,
        temperature: 0.2,
      })
    } catch (error: any) {
      this.logger.warn(`Summary generation failed, using fallback: ${error.message}`)
      return this.truncateContent(cleanContent)
    }
  }

  async generateAggregateSummary(notes: any[], context?: AiWorkflowContext): Promise<{ summary: string }> {
    if (!Array.isArray(notes) || notes.length === 0) return { summary: '' }
    const graph = this.aggregateSummaryGraph || new AggregateSummaryGraph(this.gateway)

    const summary = await this.withAiRun(
      { graphName: 'AggregateSummaryGraph', route: 'reasoning', context },
      () => graph.run(notes),
    )

    return { summary }
  }

  async buildKnowledgeGraphProposal(knowledgeBaseId: string, context?: AiWorkflowContext) {
    const id = String(knowledgeBaseId || '').trim()
    const userId = context?.userId
    if (!id) throw new BadRequestException('knowledgeBaseId is required.')
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    if (!this.knowledgeBases) throw new Error('Knowledge base service is not available.')

    const graph = this.knowledgeGraphBuildGraph || new KnowledgeGraphBuildGraph(this.gateway)
    const notes = await this.knowledgeBases.listGraphNotes(id, userId)

    return this.withAiRun(
      { graphName: 'KnowledgeGraphBuildGraph', route: 'reasoning', context },
      () => graph.run({ knowledgeBaseId: id, notes }),
    )
  }

  async generateWriterText(input: AiWriterInput, context?: AiWorkflowContext): Promise<string> {
    return this.withAiRun(
      { graphName: 'WriterGraph', route: 'text', context },
      () => this.gateway.chat({
        route: 'text',
        system: 'You are a focused writing assistant. Return only the requested content.',
        prompt: this.buildWriterPrompt(input),
        maxTokens: 1200,
        temperature: 0.5,
      }),
    )
  }

  async streamWriter(input: AiWriterInput, context?: AiWorkflowContext): Promise<ReadableStream<Uint8Array>> {
    return this.withAiRun(
      { graphName: 'WriterGraph', route: 'text', context },
      () => this.gateway.streamChat({
        route: 'text',
        system: 'You are a focused writing assistant. Return only the requested content.',
        prompt: this.buildWriterPrompt(input),
        maxTokens: 1200,
        temperature: 0.5,
      }),
    )
  }

  async generateMindmap(input: AiMindmapInput, context?: AiWorkflowContext) {
    const content = input.content
    const scenario = input.scenario || 'generate'
    const normalized = await this.withAiRun(
      { graphName: 'MindmapGenerationGraph', route: 'reasoning', context },
      async () => {
        const answer = await this.gateway.chat({
          route: 'reasoning',
          system: 'You generate valid JSON for mind map data. Return JSON only.',
          prompt: this.buildMindmapPrompt(scenario, content),
          maxTokens: 2000,
          temperature: 0.2,
        })

        return this.normalizeMindmapOrRepair(answer, scenario, content)
      },
    )

    return this.toLegacyMessages(JSON.stringify(normalized))
  }

  async generateMermaid(input: AiMermaidInput, context?: AiWorkflowContext) {
    const code = await this.withAiRun(
      { graphName: 'MermaidGenerationGraph', route: 'reasoning', context },
      async () => {
        const answer = await this.gateway.chat({
          route: 'reasoning',
          system: 'You generate Mermaid diagrams. Return Mermaid code only.',
          prompt: this.buildMermaidPrompt(input.content, input.availableIcons || []),
          maxTokens: 1800,
          temperature: 0.2,
        })

        return this.normalizeMermaidOrRepair(answer, input.content, input.availableIcons || [])
      },
    )

    return this.toLegacyMessages(code)
  }

  async chatPet(input: AiPetInput, context?: AiWorkflowContext): Promise<ReadableStream<Uint8Array>> {
    return this.withAiRun(
      { graphName: 'PetChatGraph', route: 'text', context },
      () => this.gateway.streamChat({
        route: 'text',
        system: 'You are a friendly assistant inside an online notes app. Be concise, useful, and warm.',
        prompt: input.message || 'Hello',
        maxTokens: 1200,
        temperature: 0.6,
      }),
    )
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.gateway.embedding(text)
  }

  async generateTopicName(context: string): Promise<string> {
    try {
      const answer = await this.gateway.chat({
        route: 'text',
        system: 'You name clusters of notes. Return one short topic phrase only.',
        prompt: [
          'Based on the following notes, return one short topic phrase in the same language as the notes.',
          'Use 2-6 words. Do not include quotes, punctuation, or explanation.',
          '',
          context.slice(0, 3000),
        ].join('\n'),
        maxTokens: 64,
        temperature: 0.2,
      })

      return this.cleanTopicName(answer)
    } catch (error: any) {
      this.logger.warn(`Topic naming failed, using fallback: ${error.message}`)
      return 'General Topic'
    }
  }

  private buildWriterPrompt(input: AiWriterInput): string {
    const context = this.cleanText(input.context || '')
    const extra = input.prompt ? `\nAdditional user requirement:\n${input.prompt}` : ''

    if (input.type === 'continue') {
      return `Continue the following text in the same language and style. Return only the continuation.\n\nContext:\n${context}${extra}`
    }

    if (input.type === 'polish') {
      return `Polish the following text while preserving its meaning. Return only the polished text.\n\nText:\n${context}${extra}`
    }

    return `Summarize the following text concisely. Return only the summary.\n\nText:\n${context}${extra}`
  }

  private buildMindmapPrompt(scenario: string, content: any): string {
    const serialized = typeof content === 'string' ? content : JSON.stringify(content)

    if (scenario === 'expand') {
      return [
        'Expand this mind map node with 2-5 useful child nodes.',
        'Return valid JSON only. The root id and topic must match the input node.',
        'Schema: {"id":"node-id","topic":"node topic","children":[{"id":"unique-id","topic":"child topic","children":[]}]}',
        '',
        serialized,
      ].join('\n')
    }

    if (scenario === 'optimize') {
      return [
        'Optimize this mind map JSON. Merge duplicates, improve wording, and keep the same overall structure.',
        'Return valid JSON only with schema: {"nodeData":{"id":"root","topic":"topic","children":[]}}.',
        '',
        serialized,
      ].join('\n')
    }

    return [
      'Generate a mind map in Chinese unless the topic is clearly another language.',
      'Return valid JSON only with schema: {"nodeData":{"id":"root","topic":"topic","children":[{"id":"child1","topic":"child topic","children":[]}]}}.',
      'Every node must have a unique id and a topic.',
      '',
      `Topic: ${serialized}`,
    ].join('\n')
  }

  private buildMermaidPrompt(content: string, availableIcons: string[]): string {
    const iconHint = availableIcons.length > 0
      ? `\nAvailable custom icon names. Prefer these exact names as node labels when semantically relevant: ${availableIcons.join(', ')}`
      : ''

    return [
      'Generate Mermaid.js code for the user request.',
      'Return Mermaid code only. Do not wrap in Markdown fences and do not add explanations.',
      'Use simple compatible syntax. Choose flowchart, sequenceDiagram, classDiagram, stateDiagram, or erDiagram as appropriate.',
      iconHint,
      '',
      `User request:\n${content}`,
    ].join('\n')
  }

  private async normalizeMindmapOrRepair(answer: string, scenario: string, content: any) {
    const normalized = this.normalizeMindmapAnswer(answer)
    if (normalized) return normalized

    const repaired = await this.gateway.chat({
      route: 'reasoning',
      system: 'You repair invalid mind map JSON. Return JSON only.',
      prompt: this.buildMindmapRepairPrompt(answer, scenario, content),
      maxTokens: 2000,
      temperature: 0,
    })
    const repairedNormalized = this.normalizeMindmapAnswer(repaired)
    if (!repairedNormalized) {
      throw new Error('AI mind map output is invalid after repair.')
    }

    return repairedNormalized
  }

  private async normalizeMermaidOrRepair(answer: string, content: string, availableIcons: string[]) {
    const normalized = this.normalizeMermaidCode(answer)
    if (normalized) return normalized

    const repaired = await this.gateway.chat({
      route: 'reasoning',
      system: 'You repair invalid Mermaid code. Return Mermaid code only.',
      prompt: this.buildMermaidRepairPrompt(answer, content, availableIcons),
      maxTokens: 1800,
      temperature: 0,
    })
    const repairedNormalized = this.normalizeMermaidCode(repaired)
    if (!repairedNormalized) {
      throw new Error('AI Mermaid output is invalid after repair.')
    }

    return repairedNormalized
  }

  private buildMindmapRepairPrompt(answer: string, scenario: string, content: any): string {
    const serialized = typeof content === 'string' ? content : JSON.stringify(content)
    return [
      'Repair this mind map JSON.',
      'Return valid JSON only. Do not wrap it in Markdown fences.',
      'Required schema: {"nodeData":{"id":"root","topic":"topic","root":true,"children":[{"id":"root-1","topic":"child topic","children":[]}]},"linkData":{}}.',
      'Every node must have a non-empty topic, a unique id, and a children array.',
      '',
      `Scenario: ${scenario}`,
      `Original user input:\n${serialized}`,
      '',
      `Invalid model output:\n${answer}`,
    ].join('\n')
  }

  private buildMermaidRepairPrompt(answer: string, content: string, availableIcons: string[]): string {
    const iconHint = availableIcons.length > 0
      ? `\nAvailable custom icon names: ${availableIcons.join(', ')}`
      : ''

    return [
      'Repair this Mermaid output.',
      'Return Mermaid code only. Do not wrap it in Markdown fences and do not add explanations.',
      'The first non-empty line must start with a Mermaid diagram declaration such as flowchart TD, graph LR, sequenceDiagram, classDiagram, stateDiagram, or erDiagram.',
      'Use simple compatible syntax.',
      iconHint,
      '',
      `Original user request:\n${content}`,
      '',
      `Invalid model output:\n${answer}`,
    ].join('\n')
  }

  private normalizeMindmapAnswer(answer: string) {
    const json = this.extractJsonObject(answer)
    if (!json) return null

    let parsed: any
    try {
      parsed = JSON.parse(json)
    } catch {
      return null
    }

    const rootSource = parsed?.nodeData || parsed?.root || parsed
    const root = this.normalizeMindmapNode(rootSource, 'root', new Set<string>(), true)
    if (!root) return null

    return {
      nodeData: root,
      linkData: parsed?.linkData && typeof parsed.linkData === 'object' && !Array.isArray(parsed.linkData)
        ? parsed.linkData
        : {},
    }
  }

  private normalizeMindmapNode(raw: any, fallbackId: string, usedIds: Set<string>, isRoot = false): any | null {
    if (!raw || typeof raw !== 'object') return null
    const topic = this.cleanNodeTopic(raw.topic ?? raw.content ?? raw.label ?? raw.name)
    if (!topic) return null

    const id = isRoot ? 'root' : this.uniqueNodeId(raw.id, fallbackId, usedIds)
    usedIds.add(id)

    const rawChildren = Array.isArray(raw.children)
      ? raw.children
      : Array.isArray(raw.nodes)
        ? raw.nodes
        : []

    const children = rawChildren
      .map((child: any, index: number) => this.normalizeMindmapNode(child, `${id}-${index + 1}`, usedIds))
      .filter(Boolean)

    const node: any = {
      id,
      topic,
      children,
    }

    if (isRoot) node.root = true
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) node.data = raw.data
    return node
  }

  private uniqueNodeId(rawId: unknown, fallbackId: string, usedIds: Set<string>): string {
    const base = String(rawId || fallbackId)
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallbackId

    if (!usedIds.has(base)) return base

    let index = 2
    while (usedIds.has(`${base}-${index}`)) index += 1
    return `${base}-${index}`
  }

  private cleanNodeTopic(value: unknown): string {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  }

  private extractJsonObject(answer: string): string | null {
    const text = this.stripCodeFence(answer).trim()
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace <= firstBrace) return null
    return text.slice(firstBrace, lastBrace + 1)
  }

  private normalizeMermaidCode(answer: string): string | null {
    const code = this.stripCodeFence(answer).trim()
    if (!code || code.includes('```')) return null

    const firstLine = code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('%%'))

    if (!firstLine || !this.isMermaidDeclaration(firstLine)) return null
    return code
  }

  private isMermaidDeclaration(line: string): boolean {
    return /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/i.test(line) ||
      /^(sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|gantt|journey|pie|mindmap|gitGraph)\b/i.test(line)
  }

  private stripCodeFence(answer: string): string {
    return String(answer || '')
      .replace(/^```(?:json|mermaid)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
  }

  private toLegacyMessages(content: string) {
    return {
      messages: [
        {
          role: 'assistant',
          type: 'answer',
          content: content.trim(),
        },
      ],
    }
  }

  private async withAiRun<T>(
    input: { graphName: string; route: AiChatRoute; context?: AiWorkflowContext },
    execute: () => Promise<T>,
  ): Promise<T> {
    const run = await this.startRun(input)

    try {
      const result = await execute()
      await this.succeedRun(run?.runId)
      return result
    } catch (error) {
      await this.failRun(run?.runId, error)
      throw error
    }
  }

  private async startRun(input: { graphName: string; route: AiChatRoute; context?: AiWorkflowContext }) {
    if (!this.aiRuns) return undefined

    const route = this.describeRoute(input.route)
    try {
      return await this.aiRuns.start({
        graphName: input.graphName,
        userId: input.context?.userId,
        provider: route.provider,
        model: route.model,
      })
    } catch (error: any) {
      this.logger.warn(`AI run audit start failed for ${input.graphName}: ${error.message}`)
      return undefined
    }
  }

  private async succeedRun(runId?: string) {
    if (!runId || !this.aiRuns) return
    try {
      await this.aiRuns.succeed(runId)
    } catch (error: any) {
      this.logger.warn(`AI run audit success update failed for ${runId}: ${error.message}`)
    }
  }

  private async failRun(runId: string | undefined, error: unknown) {
    if (!runId || !this.aiRuns) return
    try {
      await this.aiRuns.fail(runId, error)
    } catch (auditError: any) {
      this.logger.warn(`AI run audit failure update failed for ${runId}: ${auditError.message}`)
    }
  }

  private describeRoute(route: AiChatRoute): { provider?: string; model?: string } {
    try {
      return this.gateway.describeChatRoute(route)
    } catch (error: any) {
      this.logger.warn(`AI route description failed for ${route}: ${error.message}`)
      return { provider: undefined, model: undefined }
    }
  }

  private cleanTopicName(value: string): string {
    const cleaned = String(value || '')
      .split('\n')[0]
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[。.!?，,]+$/g, '')
      .trim()

    return cleaned.slice(0, 80) || 'General Topic'
  }

  private truncateContent(content: string): string {
    const cleanText = this.cleanText(content)
    return cleanText.substring(0, 200) + (cleanText.length > 200 ? '...' : '')
  }

  private cleanText(content: string): string {
    return String(content || '')
      .replace(/<[^>]+>/g, '')
      .replace(/[#*`_~>\[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
}
