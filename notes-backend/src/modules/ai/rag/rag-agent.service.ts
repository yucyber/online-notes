import { Injectable, Logger, Optional } from '@nestjs/common'
import { AiChatMessage, AiToolCall, AiToolDefinition } from '../ai-gateway.types'
import { AiGatewayClient } from '../ai-gateway.client'
import { AiRunService } from '../ai-run.service'
import { AiRunTiming } from '../ai-run-timing'
import { ChunkRetrievalService } from '../../semantic/chunk-retrieval.service'
import { KnowledgeBasesService } from '../../knowledge-bases/knowledge-bases.service'
import { RagEvidence, RagPlanSummary, RagTool } from './rag.types'

// —— loop 护栏 ——
// 最大轮数与输入字符预算双重兜底：轮数防死循环，字符预算防 tool 结果滚雪球撑爆上下文。
const MAX_ROUNDS = 3
const MAX_INPUT_CHARS = 60_000 // 约 15k token，超出后强制收敛进入作答
const MAX_EVIDENCE = 12        // 注册表容量；最终作答取分数前 10（与固定管线一致）
const FINAL_EVIDENCE_LIMIT = 10
const TOOL_RESULT_EXCERPT = 400 // 单条证据回传模型的摘要长度（注册表仍存 1200 全文供作答）

export type RagAgentResult = {
  evidence: RagEvidence[]
  planSummary: RagPlanSummary
  warnings: string[]
  rounds: number
  toolCalls: number
  // 工具「服务异常」次数（不含模型传错参数/未知工具这类用法错误）。
  // 调用方据此区分"检索后端坏了"和"确实没有相关笔记"：证据为空且此值 > 0 时应降级固定管线。
  toolFailures: number
  runId?: string
}

export type RagAgentHooks = {
  // 每次工具执行前回调，用于 SSE status 事件（stage 固定 retrieving）。
  onStatus(message: string): void | Promise<void>
}

// E 编号只在 loop 内部使用：注册顺序即编号，rerank 只改分数不改顺序，模型看到的 E# 全程稳定。
// 最终作答是独立的一次生成，E# 由作答 prompt 按证据数组位置重新分配，与 loop 编号无关。
const AGENT_SYSTEM = [
  '你是笔记检索代理，只负责为用户问题收集证据，不负责回答。',
  '规则：',
  '- 必须先调用检索工具；证据通常 3-8 条足够',
  '- 单一主题的问题：1 次检索即够，最多再换 1 次关键词，然后必须停止',
  '- 多主题问题（如"A 和 B 分别是什么"）：每个主题各检索 1 次即可',
  '- 证据足够后立即停止：不再调用任何工具，直接回复"检索完成"',
  '- 语义相近找内容用 search_vector；找特定词语/标题用 search_keyword；需要关联扩展用 expand_graph；要看某条证据全文用 get_note_chunk',
  '- 检索结果里 evidence 数组的 id（E1、E2…）是证据编号',
  '- 最多 3 轮，禁止重复同样的查询',
].join('\n')

const TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_vector',
      description: '语义向量检索用户笔记片段，适合按含义查找内容',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索语句，保留用户意图' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_keyword',
      description: '关键词检索用户笔记片段，适合查找包含特定词语或标题的笔记',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词' },
          keywords: { type: 'array', items: { type: 'string' }, description: '可选，最多 3 个关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'expand_graph',
      description: '基于已收集证据做知识图谱一跳扩展，补充关联笔记片段；需先有检索结果',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_note_chunk',
      description: '获取指定编号证据的完整内容',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '证据编号，如 E3' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rerank',
      description: '按与用户问题的相关度重排已收集证据的分数',
      parameters: { type: 'object', properties: {} },
    },
  },
]

// agent 工具名 → 固定管线的 RagTool 名：planSummary 与降级路径共用同一套工具标识。
const TOOL_TO_RAG_TOOL: Record<string, RagTool> = {
  search_vector: 'chunk_vector',
  search_keyword: 'keyword',
  expand_graph: 'graph_expand',
  rerank: 'rerank',
}

const TOOL_LABELS: Record<string, string> = {
  search_vector: '语义检索',
  search_keyword: '关键词检索',
  expand_graph: '图谱扩展',
  get_note_chunk: '读取片段全文',
  rerank: '相关度重排',
}

type AgentContext = {
  question: string
  userId: string
  knowledgeBaseId?: string
  registry: RagEvidence[]
  calledTools: Set<string>
  warnings: string[]
  rerankApplied: boolean
  graphExpanded: boolean
  toolFailures: number
}

@Injectable()
export class RagAgentService {
  private readonly logger = new Logger(RagAgentService.name)

  constructor(
    private readonly gateway: AiGatewayClient,
    private readonly chunks: ChunkRetrievalService,
    private readonly knowledgeBases: KnowledgeBasesService,
    @Optional() private readonly runs?: AiRunService,
  ) {}

  // 证据收集 loop：模型发起 tool call → 执行 → 结果回填 → 继续/停止。
  // 任何异常由调用方（streamRagAnswer）降级回固定管线，本服务不内部兜底。
  async collect(
    input: { question: string; userId: string; knowledgeBaseId?: string },
    hooks: RagAgentHooks,
  ): Promise<RagAgentResult> {
    const runId = await this.startRun(input.userId)
    const timing = new AiRunTiming(async (stage) => {
      if (!runId) return
      try { await this.runs?.addStage(runId, stage) } catch { this.logger.warn('agent stage audit update failed') }
    })

    const ctx: AgentContext = {
      ...input,
      registry: [],
      calledTools: new Set(),
      warnings: [],
      rerankApplied: false,
      graphExpanded: false,
      toolFailures: 0,
    }
    const messages: AiChatMessage[] = [
      { role: 'system', content: AGENT_SYSTEM },
      { role: 'user', content: input.question },
    ]
    let rounds = 0
    let toolCalls = 0
    let stopReason: 'done' | 'max_rounds' | 'budget' = 'done'

    try {
      while (rounds < MAX_ROUNDS) {
        // 输入预算护栏：消息累计字符超限即停止检索，用已有证据作答
        const inputChars = messages.reduce((sum, m) => sum + String(m.content || '').length, 0)
        if (inputChars > MAX_INPUT_CHARS) { stopReason = 'budget'; break }

        const round = await timing.measure('provider', () => this.gateway.chatToolRound({
          task: 'rag_answer',
          tools: TOOL_DEFINITIONS,
          messages,
          maxTokens: 512,
          temperature: 0,
        }))
        rounds += 1
        // 模型不再调用工具：视为证据收集完成
        if (!round.toolCalls.length) break
        if (rounds >= MAX_ROUNDS) stopReason = 'max_rounds'

        messages.push({ role: 'assistant', content: round.content || null, toolCalls: round.toolCalls })
        for (const call of round.toolCalls) {
          toolCalls += 1
          const output = await timing.measure('context_prepare', () =>
            this.executeTool(call, ctx, hooks, rounds),
          )
          messages.push({ role: 'tool', toolCallId: call.id, content: output })
        }
      }
    } catch (error) {
      // loop 失败要把 run 标记失败再抛出，避免观测面板出现悬挂的进行中记录
      if (runId) await this.runs?.fail(runId, error).catch(() => undefined)
      throw error
    }

    if (stopReason === 'max_rounds') ctx.warnings.push('已达最大检索轮数，使用已收集证据作答')
    if (stopReason === 'budget') ctx.warnings.push('检索上下文已达预算上限，使用已收集证据作答')
    // 工具异常是可观测事实，必须在 warnings 里留痕，否则上层只能看到"证据为空"，分不清是
    // 检索后端故障还是用户确实没有相关笔记。
    if (ctx.toolFailures > 0) ctx.warnings.push(`检索工具异常 ${ctx.toolFailures} 次`)

    // 最终证据按分数排序取前 N：顺序即作答 prompt 的 E 编号（与 sanitizer 同一数组）
    const evidence = [...ctx.registry].sort((left, right) => right.score - left.score).slice(0, FINAL_EVIDENCE_LIMIT)
    if (runId) {
      await this.runs?.mergeMetrics(runId, {
        candidateNotes: new Set(evidence.map((item) => item.noteId)).size,
        candidateChunks: ctx.registry.length,
      }).catch(() => undefined)
      // 空证据走"未找到相关片段"提前返回，不会再有作答流来关闭 run，这里直接收尾。
      if (evidence.length === 0) await this.runs?.succeed(runId).catch(() => undefined)
    }
    const planSummary: RagPlanSummary = {
      intent: 'agent',
      tools: [...ctx.calledTools].flatMap((name) => (TOOL_TO_RAG_TOOL[name] ? [TOOL_TO_RAG_TOOL[name]] : [])),
      graphHops: ctx.graphExpanded ? 1 : 0,
      rerankApplied: ctx.rerankApplied,
    }
    return { evidence, planSummary, warnings: ctx.warnings, rounds, toolCalls, toolFailures: ctx.toolFailures, runId }
  }

  // 执行单个 tool call：参数校验失败与服务异常都转为错误结果回填，让模型自纠而不是中断 loop。
  private async executeTool(call: AiToolCall, ctx: AgentContext, hooks: RagAgentHooks, round: number): Promise<string> {
    ctx.calledTools.add(call.name)
    let args: any = {}
    try { args = JSON.parse(call.arguments || '{}') } catch { return this.toolError('arguments 必须是合法 JSON') }
    try {
      await hooks.onStatus(`第 ${round} 轮检索：${TOOL_LABELS[call.name] || call.name}`)
      switch (call.name) {
        case 'search_vector': return await this.runSearch(ctx, args, 'chunk_vector')
        case 'search_keyword': return await this.runSearch(ctx, args, 'keyword')
        case 'expand_graph': return await this.runExpandGraph(ctx)
        case 'get_note_chunk': return await this.runGetChunk(ctx, args)
        case 'rerank': return await this.runRerank(ctx)
        default: return this.toolError(`未知工具 ${call.name}，可用：${TOOL_DEFINITIONS.map((t) => t.function.name).join(', ')}`)
      }
    } catch (error) {
      // 只有这里是"工具本身坏了"（检索服务异常）。上面 JSON 解析失败、未知工具名属模型用法错误，
      // 模型可自纠，不计入 toolFailures —— 否则会把正常的自纠轮次误判成检索后端故障而触发降级。
      ctx.toolFailures += 1
      this.logger.warn(`agent tool ${call.name} failed: ${error?.message ?? error}`)
      return this.toolError('工具执行失败，可调整参数重试或直接停止检索')
    }
  }

  private async runSearch(ctx: AgentContext, args: any, source: RagTool): Promise<string> {
    const query = String(args?.query || '').trim()
    if (!query) return this.toolError('缺少必填参数 query')
    const results = source === 'keyword'
      ? await this.chunks.searchKeywordChunks({ query, keywords: Array.isArray(args.keywords) ? args.keywords : undefined, limit: 8, knowledgeBaseId: ctx.knowledgeBaseId }, ctx.userId)
      : await this.chunks.searchChunks({ query, limit: 8, knowledgeBaseId: ctx.knowledgeBaseId }, ctx.userId)
    return this.registerEvidence(ctx, results, source)
  }

  private async runExpandGraph(ctx: AgentContext): Promise<string> {
    if (!ctx.registry.length) return this.toolError('尚无已收集证据可作为图谱扩展种子，请先检索')
    try {
      const graph = ctx.knowledgeBaseId
        ? await this.knowledgeBases.expandGraphEvidence(ctx.knowledgeBaseId, ctx.userId, ctx.registry.map((item) => item.chunkId))
        : (await this.knowledgeBases.expandGraphEvidenceAuto(ctx.userId, ctx.registry.map((item) => ({ chunkId: item.chunkId, noteId: item.noteId })))).evidence
      ctx.graphExpanded = true
      return this.registerEvidence(ctx, graph, 'graph_expand')
    } catch {
      ctx.warnings.push('知识图谱扩展不可用，已跳过')
      return this.toolError('图谱扩展暂不可用，可继续检索或停止')
    }
  }

  private async runGetChunk(ctx: AgentContext, args: any): Promise<string> {
    const id = String(args?.id || '').trim().toUpperCase()
    const index = this.evidenceIndex(id, ctx)
    const item = index >= 0 ? ctx.registry[index] : undefined
    if (!item) {
      const available = ctx.registry.map((_, i) => `E${i + 1}`).join(', ')
      return this.toolError(`未找到证据 ${id || '(空)'}${available ? `，可用编号：${available}` : '，当前尚无证据'}`)
    }
    // 注册表内容可能被截断（1200 字符）；重新按 chunkId 取全文，权限校验与搜索路径一致
    const full = await this.chunks.getChunkById(item.chunkId, ctx.userId)
    const content = full?.content || item.content
    return JSON.stringify({ id, note: item.noteTitle, heading: item.headingPath.join(' > '), content: content.slice(0, 2000) })  }

  private async runRerank(ctx: AgentContext): Promise<string> {
    if (ctx.registry.length < 2) return this.toolError('证据不足 2 条，无需重排')
    const ranked = await this.gateway.rerank(ctx.question, ctx.registry.map((item) => item.content))
    const scoreByIndex = new Map(ranked.map((item) => [item.index, item.score]))
    ctx.registry.forEach((item, index) => { item.score = scoreByIndex.get(index) ?? item.score })
    ctx.rerankApplied = true
    // 只改分数不动顺序：loop 内 E 编号全程稳定，模型看到的编号不会漂移
    const order = ctx.registry.map((item, index) => ({ id: `E${index + 1}`, score: Math.round(item.score * 1000) / 1000 }))
    return JSON.stringify({ reranked: true, evidence: order })
  }

  // 注册证据：chunkId 去重、容量封顶；返回给模型的编号列表（E# = 注册顺序 + 1）
  private registerEvidence(ctx: AgentContext, items: any[], source: RagTool): string {
    let duplicates = 0
    const existing = new Set(ctx.registry.map((item) => item.chunkId))
    const added: Array<{ id: string; note: string; heading: string; excerpt: string }> = []
    for (const raw of items || []) {
      const content = String(raw.content || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
      const chunkId = String(raw.chunkId || raw._id || '')
      if (!chunkId || existing.has(chunkId)) { duplicates += 1; continue }
      if (ctx.registry.length >= MAX_EVIDENCE) continue
      existing.add(chunkId)
      ctx.registry.push({
        noteId: String(raw.noteId || ''),
        noteTitle: raw.noteTitle || raw.title || '',
        chunkId,
        headingPath: Array.isArray(raw.headingPath) ? raw.headingPath.map(String) : [],
        excerpt: content.slice(0, 700),
        content,
        score: Number(raw.score ?? 0.35),
        source,
        ...(raw.graphPath ? { graphPath: raw.graphPath } : {}),
      })
      added.push({
        id: `E${ctx.registry.length}`,
        note: ctx.registry[ctx.registry.length - 1].noteTitle,
        heading: ctx.registry[ctx.registry.length - 1].headingPath.join(' > '),
        excerpt: content.slice(0, TOOL_RESULT_EXCERPT),
      })
    }
    return JSON.stringify({ evidence: added, duplicates, registered: ctx.registry.length })
  }

  private evidenceIndex(id: string, ctx: AgentContext): number {
    const match = /^E(\d+)$/.exec(id)
    const index = match ? Number(match[1]) - 1 : -1
    return index >= 0 && index < ctx.registry.length ? index : -1
  }

  private toolError(message: string): string {
    return JSON.stringify({ error: message })
  }

  private async startRun(userId: string): Promise<string | undefined> {
    if (!this.runs) return undefined
    try {
      const route = this.gateway.describeTaskRoute('rag_answer')
      const run = await this.runs.start({ graphName: 'RagAgentLoop', task: 'rag_answer', userId, provider: route?.provider, model: route?.model })
      return run.runId
    } catch {
      this.logger.warn('agent run audit start failed')
      return undefined
    }
  }
}
