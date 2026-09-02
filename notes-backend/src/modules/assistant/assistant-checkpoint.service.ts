import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AiGatewayClient } from '../ai/ai-gateway.client'
import { AssistantMessagesService } from './assistant-messages.service'
import { toObjectId } from './object-id.util'
import { AssistantContextCheckpoint, AssistantCheckpointDocument } from './schemas/assistant-checkpoint.schema'

export type AssistantCheckpointView = {
  conversationId: string; throughSeq: number; summary: string; decisions: string[]; openQuestions: string[]; referencedEntities: string[]; sourceMessageIds: string[]; createdAt: string
}

@Injectable()
export class AssistantCheckpointService {
  private readonly logger = new Logger(AssistantCheckpointService.name)
  constructor(
    @InjectModel(AssistantContextCheckpoint.name) private readonly model: Model<AssistantCheckpointDocument>,
    private readonly gateway: AiGatewayClient,
    private readonly messages: AssistantMessagesService,
  ) {}

  async getLatest(userId: string, conversationId: string): Promise<AssistantCheckpointView | null> {
    const doc = await this.model.findOne({ userId: toObjectId(userId), conversationId: toObjectId(conversationId) })
      .sort({ throughSeq: -1 }).lean().exec()
    if (!doc) return null
    return this.toView(doc)
  }

  async build(userId: string, conversationId: string): Promise<AssistantCheckpointView> {
    const latest = await this.getLatest(userId, conversationId)
    const afterSeq = latest?.throughSeq ?? 0
    const recent = await this.messages.list(userId, conversationId, { afterSeq })
    // 只取 completed 消息做摘要：失败/取消/占位不代表"已明确结论"，与分支复制只带成功回答的策略一致。
    const completed = recent.filter((m) => m.status === 'completed')
    if (recent.length === 0 || completed.length === 0) {
      // 没有新消息或窗口内无成功消息时保留现有 checkpoint；不存在则返回空摘要，避免无谓的模型调用。
      return latest ?? { conversationId, throughSeq: 0, summary: '', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [], createdAt: new Date().toISOString() }
    }
    // 按字符预算逐条累积 transcript：预算耗尽即停，throughSeq 只推进到实际纳入的最后一条，
    // 避免截断尾部消息被计入已压缩范围而永久漏压（长窗口手动整理时尾部可能不进 prompt）。
    const MAX_CHARS = 12000
    const lines: string[] = []
    let used = 0
    let coveredSeq = completed[0].seq - 1
    for (const m of completed) {
      const line = `${m.role}: ${m.content}`
      if (used + line.length > MAX_CHARS && lines.length > 0) break
      lines.push(line)
      used += line.length
      coveredSeq = m.seq
    }
    const throughSeq = Math.max(latest?.throughSeq ?? 0, coveredSeq)
    const result = await this.gateway.chatTask({
      task: 'context_summary', responseFormat: { type: 'json_object' }, maxTokens: 512, temperature: 0,
      system: 'Summarize a conversation for continuity. Return JSON only: {"summary":"...","decisions":["..."],"openQuestions":["..."],"referencedEntities":["..."]}. Only state what was explicitly agreed; do not invent facts.',
      prompt: lines.join('\n'),
    })
    const value = JSON.parse(result.content)
    const doc = await this.model.findOneAndUpdate(
      { conversationId: toObjectId(conversationId), userId: toObjectId(userId) },
      {
        $set: {
          conversationId: toObjectId(conversationId), userId: toObjectId(userId), throughSeq,
          summary: String(value?.summary || '').trim(),
          decisions: Array.isArray(value?.decisions) ? value.decisions.map(String).slice(0, 20) : [],
          openQuestions: Array.isArray(value?.openQuestions) ? value.openQuestions.map(String).slice(0, 20) : [],
          referencedEntities: Array.isArray(value?.referencedEntities) ? value.referencedEntities.map(String).slice(0, 20) : [],
          sourceMessageIds: completed.filter((m) => m.seq <= throughSeq).map((m) => toObjectId(m.id)),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec()
    return this.toView(doc)
  }

  async schedule(userId: string, conversationId: string, latestSeq: number) {
    const latest = await this.getLatest(userId, conversationId)
    // 距上一 checkpoint 至少 10 条新消息才压缩，避免频繁模型调用。
    if (latest && latestSeq - latest.throughSeq < 10) return
    void this.build(userId, conversationId).catch((error) => this.logger.warn(`checkpoint build failed: ${error?.message}`))
  }

  private toView(doc: any): AssistantCheckpointView {
    return {
      conversationId: String(doc.conversationId), throughSeq: Number(doc.throughSeq),
      summary: String(doc.summary || ''), decisions: Array.isArray(doc.decisions) ? doc.decisions.map(String) : [],
      openQuestions: Array.isArray(doc.openQuestions) ? doc.openQuestions.map(String) : [],
      referencedEntities: Array.isArray(doc.referencedEntities) ? doc.referencedEntities.map(String) : [],
      sourceMessageIds: Array.isArray(doc.sourceMessageIds) ? doc.sourceMessageIds.map(String) : [],
      createdAt: String(doc.createdAt || new Date().toISOString()),
    }
  }
}
