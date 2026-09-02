import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { MemoryRecallServiceLike } from './assistant.constants'
import { toObjectId } from './object-id.util'
import { AssistantMemory, AssistantMemoryDocument } from './schemas/assistant-memory.schema'

// 中文分词：与 assistant-context.service recallHistorical 同源——CJK 连续段拆 2 字滑动窗口（bigram），
// 非 CJK 片段按空白/标点拆词级 token；空格 split 对 CJK 无效（整句成 1 token，召回必然落空）。
const isCjk = (ch: string) => /[\u4e00-\u9fff]/.test(ch)
const isSep = (ch: string) => /[\s,.;:!?，。；：！？、（）()[\]{}"'“”‘’—…]/.test(ch)

@Injectable()
export class MemoryRecallService implements MemoryRecallServiceLike {
  constructor(@InjectModel(AssistantMemory.name) private readonly model: Model<AssistantMemoryDocument>) {}

  // 只召回已确认、证据有效、未过期、未被替代且范围兼容的认知，按问题 token 命中数降序取前 limit（默认 5）。
  async recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }) {
    const q = String(question || '').trim()
    const tokens = this.tokenize(q)
    if (tokens.length === 0) return []
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const now = new Date()
    const docs = await this.model.find({
      userId: toObjectId(userId),
      status: 'confirmed',
      evidenceStatus: 'ok',
      supersededById: { $exists: false },
      $or: [{ validTo: { $exists: false } }, { validTo: null }, { validTo: { $gte: now } }],
      $and: [
        { $or: [{ subject: { $regex: pattern, $options: 'i' } }, { statement: { $regex: pattern, $options: 'i' } }] },
      ],
    }).sort({ updatedAt: -1 }).limit(100).lean() as any[]

    const compatible = docs.filter((doc) => {
      // 防御索引/查询漂移：内存侧再校验一次召回条件（已确认、证据有效、未过期、未被替代、范围兼容）。
      if (doc.status !== 'confirmed' || doc.evidenceStatus !== 'ok') return false
      if (doc.supersededById) return false
      if (doc.validTo && new Date(doc.validTo) < now) return false
      const type = doc.scope?.type
      if (type === 'global') return true
      if (type === 'knowledge_base') return opts?.knowledgeBaseId ? String(doc.scope.id) === String(opts.knowledgeBaseId) : false
      if (type === 'note') return opts?.noteId ? String(doc.scope.id) === String(opts.noteId) : false
      if (type === 'conversation') return opts?.conversationId ? String(doc.scope.id) === String(opts.conversationId) : false
      return false
    })
    const scored = compatible
      .map((doc) => {
        const text = `${doc.subject} ${doc.statement}`.toLowerCase()
        const score = tokens.reduce((total, token) => total + (text.includes(token.toLowerCase()) ? 1 : 0), 0)
        return { doc, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts?.limit ?? 5)
    return scored.map(({ doc }) => ({
      label: '已确认认知',
      text: `${doc.statement}（范围：${doc.scope?.type}${doc.scope?.id ? ` ${doc.scope.id}` : ''}）`,
    }))
  }

  // CJK bigram + 非 CJK 词级 token，去重后取 ≥2 字（同 recallHistorical 的分词口径，保证两端召回一致）。
  private tokenize(question: string): string[] {
    const words: string[] = []
    const cjkChars: string[] = []
    let buf = ''
    for (const ch of question) {
      if (isCjk(ch)) {
        cjkChars.push(ch)
        if (buf.trim()) { words.push(buf.trim()); buf = '' }
      } else if (isSep(ch)) {
        if (buf.trim()) { words.push(buf.trim()); buf = '' }
      } else buf += ch
    }
    if (buf.trim()) words.push(buf.trim())
    for (let i = 0; i + 1 < cjkChars.length; i++) words.push(cjkChars[i] + cjkChars[i + 1])
    return [...new Set(words)].filter((t) => t.length >= 2)
  }
}
