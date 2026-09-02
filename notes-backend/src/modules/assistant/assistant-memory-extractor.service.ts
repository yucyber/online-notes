import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { createHash } from 'node:crypto'
import { Model } from 'mongoose'
import { AiGatewayClient } from '../ai/ai-gateway.client'
import { AssistantMessagesService } from './assistant-messages.service'
import { MEMORY_KINDS, MemoryEvidence, MemoryKind } from './assistant.constants'
import { toObjectId } from './object-id.util'
import { AssistantMemoryCandidate, AssistantMemoryCandidateDocument } from './schemas/assistant-memory-candidate.schema'
import { AssistantConversationsService } from './assistant-conversations.service'

// 提取窗口（条）：取最近 N 条消息整段喂给模型，模型只按 messageIds 指认证据；
// 窗口位置与状态查询解耦，重复提取靠 evidenceKey 去重兜底。
const EXTRACT_WINDOW = 6

@Injectable()
export class AssistantMemoryExtractorService {
  private readonly logger = new Logger(AssistantMemoryExtractorService.name)

  constructor(
    @InjectModel(AssistantMemoryCandidate.name) private readonly candidateModel: Model<AssistantMemoryCandidateDocument>,
    private readonly gateway: AiGatewayClient,
    private readonly messages: AssistantMessagesService,
    @Optional() private readonly conversations?: AssistantConversationsService,
  ) {}

  // 异步候选提取：临时会话与关闭记忆的会话不产生长期候选；
  // 设置读取失败时按允许提取降级（设置故障不应阻塞聊天链路）。
  async extract(userId: string, conversationId: string): Promise<{ created: number; skipped: number }> {
    if (this.conversations) {
      try {
        const settings = await this.conversations.getSettings(userId, conversationId)
        if (settings.memoryEnabled === false || settings.temporary) return { created: 0, skipped: 0 }
      } catch (error) {
        this.logger.warn(`memory settings check failed, proceeding: ${conversationId} ${error?.message ?? error}`)
      }
    }

    // 长会话必须取最近一轮：messages.list 按 seq 升序且封顶 200 条（= 最旧 200 条），再取尾部会让窗口
    // 卡死在旧消息、最新轮次永不提取；改用 listBefore 由 DB 侧按 seq 倒序取最近 EXTRACT_WINDOW 条（已反序回升序）。
    const recent = (await this.messages.listBefore(userId, conversationId, { limit: EXTRACT_WINDOW })).slice(-EXTRACT_WINDOW)
    if (recent.length === 0) return { created: 0, skipped: 0 }

    // assistant 消息的 citations 转成 note_chunk 证据行，供模型据此判断候选是否立足笔记内容。
    // 每行前缀 [m:<id>] 暴露消息 id：模型在 messageIds 里只能引用它真实见过的 id，否则 evidence 反查
    // m.id 恒空、note_chunk 转换与降级规则全部不可达（R1-1 修复）。
    const transcript = recent.map((m) => {
      const citeNote = m.citations.length > 0
        ? `\n引用笔记片段：${m.citations.map((c) => `[${c.evidenceId}] ${c.noteTitle} ${c.excerpt}`).join('；')}`
        : ''
      return `[m:${m.id}] ${m.role}: ${m.content}${citeNote}`
    }).join('\n')

    let parsed: any
    try {
      const result = await this.gateway.chatTask({
        task: 'memory_extract',
        responseFormat: { type: 'json_object' },
        maxTokens: 512,
        temperature: 0,
        system: `Extract durable memory candidates from this conversation. Each transcript line starts with its message id as [m:<message-id>]. Allowed kinds: ${MEMORY_KINDS.join(', ')}. Return JSON only: {"candidates":[{"kind":"...","subject":"short topic","statement":"one-sentence fact/decision","confidence":0-1,"messageIds":["..."]}]}, where "messageIds" must contain exactly the [m:<message-id>] values of the lines that support the candidate. Rules: ignore small talk, emotions, and speculation. A suggestion made only by the assistant and not confirmed by the user must use kind "hypothesis". Do not invent facts.`,
        prompt: transcript.slice(0, 12000),
      })
      parsed = JSON.parse(result.content)
    } catch (error) {
      this.logger.warn(`memory extract failed: ${error?.message ?? error}`)
      return { created: 0, skipped: 0 }
    }

    const rawCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
    let created = 0
    let skipped = 0
    for (const raw of rawCandidates) {
      // kind 不在白名单（模型幻觉/空值）直接丢弃，不猜默认值。
      const kind: MemoryKind | undefined = MEMORY_KINDS.includes(raw?.kind) ? raw.kind : undefined
      if (!kind) { skipped += 1; continue }
      const subject = String(raw?.subject || '').trim().slice(0, 80)
      const statement = String(raw?.statement || '').trim().slice(0, 500)
      if (!subject || !statement) { skipped += 1; continue }
      const messageIds = Array.isArray(raw?.messageIds) ? raw.messageIds.map(String).slice(0, 8) : []
      // 证据权重：候选只来自 assistant 建议、又无对应 note_chunk 笔记证据时，用户并未确认，强制降级为 hypothesis。
      const assistantOnly = messageIds.every((id: string) => !recent.some((m) => m.id === id && m.role === 'user'))
      const hasNoteEvidence = recent.some((m) => m.citations.length > 0 && messageIds.includes(m.id))
      const resolvedKind: MemoryKind = assistantOnly && !hasNoteEvidence ? 'hypothesis' : kind
      const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0.5))
      const evidence: MemoryEvidence[] = messageIds.map((id: string) => {
        const message = recent.find((m) => m.id === id)
        if (!message) return null
        const excerpt = message.content.replace(/\s+/g, ' ').trim().slice(0, 160)
        if (message.role === 'assistant' && message.citations.length > 0) {
          return { type: 'note_chunk' as const, noteId: message.citations[0].noteId, chunkId: message.citations[0].chunkId, excerpt }
        }
        return { type: 'message' as const, messageId: id, excerpt }
      }).filter((e): e is MemoryEvidence => e !== null)
      if (evidence.length === 0) { skipped += 1; continue }
      // 去重锚点：sha1(userId|kind|subject|conversationId|messageIds)。evidenceKey 有唯一索引，
      // 拒绝（rejected）记录在候选确认服务中处理（改写 key 释放锚点），此处仅按键查重。
      const evidenceKey = createHash('sha1').update([userId, resolvedKind, subject, conversationId, messageIds.join(',')].join('|')).digest('hex')
      const existing = await this.candidateModel.findOne({ evidenceKey })
      if (existing) { skipped += 1; continue }
      try {
        await this.candidateModel.insertMany([{
          userId: toObjectId(userId), conversationId: toObjectId(conversationId),
          kind: resolvedKind, subject, statement, scope: { type: 'global' }, confidence, evidence, evidenceKey,
        }])
        created += 1
      } catch (error) {
        // 落库失败（如并发撞唯一索引）视为跳过，不让单条候选拖垮整轮提取。
        this.logger.warn(`memory candidate insert failed: ${error?.message ?? error}`)
        skipped += 1
      }
    }
    return { created, skipped }
  }

  // fire-and-forget 触发（候选确认服务的"重提"入口与未来收尾调用共用）；
  // throughSeq 保留给调用方语义（在哪个问答节点之后触发），提取窗口与去重都在 extract 内部完成，不消费该值。
  schedule(userId: string, conversationId: string, _throughSeq?: number): void {
    void this.extract(userId, conversationId).catch((error) => this.logger.warn(`memory extract schedule failed: ${error?.message ?? error}`))
  }
}
