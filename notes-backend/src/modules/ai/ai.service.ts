import { Injectable, Logger } from '@nestjs/common'
import { AiGatewayClient } from './ai-gateway.client'
import { AiMermaidInput, AiMindmapInput, AiPetInput, AiWriterInput } from './ai-gateway.types'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(private readonly gateway: AiGatewayClient) {}

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

  async generateAggregateSummary(notes: any[]): Promise<{ summary: string }> {
    const formatted = (notes || []).slice(0, 50).map((note: any, index: number) => {
      const title = String(note?.title || `Note ${index + 1}`)
      const updatedAt = note?.updatedAt ? new Date(note.updatedAt).toISOString() : 'unknown time'
      const content = this.cleanText(String(note?.content || '')).slice(0, 2000)
      return `Title: ${title}\nUpdated: ${updatedAt}\nContent:\n${content}`
    }).join('\n\n---\n\n')

    if (!formatted) return { summary: '' }

    const summary = await this.gateway.chat({
      route: 'reasoning',
      system: 'You write concise synthesis summaries for selected notes.',
      prompt: [
        'Create a structured Chinese summary for these selected notes.',
        'Return readable Markdown with sections for key points, decisions, risks, and next actions when applicable.',
        'Do not mention that you are an AI.',
        '',
        formatted,
      ].join('\n'),
      maxTokens: 1600,
      temperature: 0.3,
    })

    return { summary }
  }

  async generateWriterText(input: AiWriterInput): Promise<string> {
    return this.gateway.chat({
      route: 'text',
      system: 'You are a focused writing assistant. Return only the requested content.',
      prompt: this.buildWriterPrompt(input),
      maxTokens: 1200,
      temperature: 0.5,
    })
  }

  async streamWriter(input: AiWriterInput): Promise<ReadableStream<Uint8Array>> {
    return this.gateway.streamChat({
      route: 'text',
      system: 'You are a focused writing assistant. Return only the requested content.',
      prompt: this.buildWriterPrompt(input),
      maxTokens: 1200,
      temperature: 0.5,
    })
  }

  async generateMindmap(input: AiMindmapInput) {
    const content = input.content
    const scenario = input.scenario || 'generate'
    const answer = await this.gateway.chat({
      route: 'reasoning',
      system: 'You generate valid JSON for mind map data. Return JSON only.',
      prompt: this.buildMindmapPrompt(scenario, content),
      maxTokens: 2000,
      temperature: 0.2,
    })

    return this.toLegacyMessages(answer)
  }

  async generateMermaid(input: AiMermaidInput) {
    const answer = await this.gateway.chat({
      route: 'reasoning',
      system: 'You generate Mermaid diagrams. Return Mermaid code only.',
      prompt: this.buildMermaidPrompt(input.content, input.availableIcons || []),
      maxTokens: 1800,
      temperature: 0.2,
    })

    return this.toLegacyMessages(answer)
  }

  async chatPet(input: AiPetInput): Promise<ReadableStream<Uint8Array>> {
    return this.gateway.streamChat({
      route: 'text',
      system: 'You are a friendly assistant inside an online notes app. Be concise, useful, and warm.',
      prompt: input.message || 'Hello',
      maxTokens: 1200,
      temperature: 0.6,
    })
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
