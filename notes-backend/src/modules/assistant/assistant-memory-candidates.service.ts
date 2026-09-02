import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { MEMORY_KINDS, MemoryKind, MemoryScope } from './assistant.constants'
import { toObjectId } from './object-id.util'
import { AssistantMemory, AssistantMemoryDocument } from './schemas/assistant-memory.schema'
import { AssistantMemoryCandidate, AssistantMemoryCandidateDocument } from './schemas/assistant-memory-candidate.schema'

// 确认时允许用户修改的字段；缺省沿用候选原值。scope.id 锚定非 global 范围的实体。
export type MemoryConfirmEdits = Partial<{ kind: MemoryKind; subject: string; statement: string; scope: MemoryScope; validFrom: string }>

export type MemoryConfirmConflict = { memoryId: string; subject: string; statement: string }

// conflict 存在时 memoryId 为空串：候选先置 confirmed 挂起、不写长期记忆，
// 由后续冲突解决任务在长期记忆侧处理（supersede/keep_both/reject_memory）。
export type MemoryConfirmResult = { memoryId: string; conflict?: MemoryConfirmConflict }

const SCOPE_TYPES = ['global', 'knowledge_base', 'note', 'conversation'] as const

// scope 比较用 type + 归一化 id（ObjectId 转字符串），避免对象引用/键序差异误判。
function scopeEquals(a?: MemoryScope, b?: MemoryScope): boolean {
  if (!a || !b || a.type !== b.type) return false
  const aid = a.id ? String(a.id) : ''
  const bid = b.id ? String(b.id) : ''
  return aid === bid
}

@Injectable()
export class MemoryCandidatesService {
  constructor(
    @InjectModel(AssistantMemoryCandidate.name) private readonly candidateModel: Model<AssistantMemoryCandidateDocument>,
    @InjectModel(AssistantMemory.name) private readonly memoryModel: Model<AssistantMemoryDocument>,
  ) {}

  async listPending(userId: string): Promise<Array<{ id: string; kind: MemoryKind; subject: string; statement: string; scope: MemoryScope; confidence: number; evidence: any[]; createdAt: string }>> {
    const docs = await this.candidateModel.find({ userId: toObjectId(userId), status: 'pending' })
      .sort({ createdAt: -1 }).limit(100).lean().exec() as any[]
    return docs.map((doc) => ({
      id: String(doc._id), kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope,
      confidence: Number(doc.confidence), evidence: doc.evidence || [], createdAt: String(doc.createdAt || ''),
    }))
  }

  // 确认：先原子地把 pending 候选置 confirmed（含并发双击时第二次无命中），
  // 再做冲突检测——同 scope + 主题词重叠的已确认节点存在则返回 conflict 且不写长期记忆，
  // 候选保持 confirmed 挂起供后续冲突解决任务回溯（不写记忆时它不再出现在 pending 列表）。
  async confirm(userId: string, candidateId: string, edits?: MemoryConfirmEdits): Promise<MemoryConfirmResult> {
    const candidate = await this.candidateModel.findOneAndUpdate(
      { _id: toObjectId(candidateId), userId: toObjectId(userId), status: 'pending' },
      { $set: { status: 'confirmed' } },
      { new: true },
    ).lean().exec() as any
    if (!candidate) throw new NotFoundException('candidate not found')

    const kind = edits?.kind ?? candidate.kind
    const subject = edits?.subject ?? candidate.subject
    const statement = edits?.statement ?? candidate.statement
    const scope = edits?.scope ?? candidate.scope

    const conflict = await this.findConflict(userId, kind, subject, scope)
    if (conflict) {
      return { memoryId: '', conflict: { memoryId: String(conflict._id), subject: conflict.subject, statement: conflict.statement } }
    }

    const memory = await this.memoryModel.create({
      userId: toObjectId(userId), conversationId: candidate.conversationId, kind, subject, statement, scope,
      status: 'confirmed', confidence: Number(candidate.confidence), evidence: candidate.evidence || [],
      validFrom: edits?.validFrom ? new Date(edits.validFrom) : new Date(),
      confirmedAt: new Date(), candidateId: candidate._id,
    })
    return { memoryId: String(memory._id) }
  }

  async reject(userId: string, candidateId: string, reason: string): Promise<void> {
    const result = await this.candidateModel.updateOne(
      { _id: toObjectId(candidateId), userId: toObjectId(userId), status: 'pending' },
      { $set: { status: 'rejected', rejectionReason: String(reason || '').trim().slice(0, 200) } },
    ).exec()
    if (result.matchedCount === 0) throw new NotFoundException('candidate not found')
  }

  // 批量确认：要求所有待确认候选同 kind、同 scope（前端按分组展示将写入内容，这里兜底校验）；
  // 单条命中冲突时计入 conflicts 且不写记忆、不改候选状态，避免静默丢候选。
  async batchConfirm(userId: string, ids: string[], opts: { kind?: MemoryKind; scope?: MemoryScope }): Promise<{ confirmed: number; conflicts: number }> {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((id) => id.length > 0))]
    const kind = opts?.kind
    const scope = opts?.scope
    if (list.length === 0) throw new BadRequestException('ids must not be empty')
    if (!kind || !MEMORY_KINDS.includes(kind)) throw new BadRequestException('invalid kind')
    if (!scope || !SCOPE_TYPES.includes(scope.type as any)) throw new BadRequestException('invalid scope')

    const docs = await this.candidateModel.find({
      _id: { $in: list.map((id) => toObjectId(id)) }, userId: toObjectId(userId), status: 'pending',
    }).lean().exec() as any[]
    if (docs.length !== list.length || docs.some((doc) => doc.kind !== kind || !scopeEquals(doc.scope, scope))) {
      throw new BadRequestException('batch candidates must share the same kind and scope')
    }

    let confirmed = 0
    let conflicts = 0
    for (const doc of docs) {
      const conflict = await this.findConflict(userId, doc.kind, doc.subject, doc.scope)
      if (conflict) { conflicts += 1; continue }
      await this.memoryModel.create({
        userId: toObjectId(userId), conversationId: doc.conversationId, kind: doc.kind, subject: doc.subject,
        statement: doc.statement, scope: doc.scope, status: 'confirmed', confidence: Number(doc.confidence),
        evidence: doc.evidence || [], validFrom: new Date(), confirmedAt: new Date(), candidateId: doc._id,
      })
      await this.candidateModel.updateOne({ _id: doc._id }, { $set: { status: 'confirmed' } }).exec()
      confirmed += 1
    }
    return { confirmed, conflicts }
  }

  // 冲突判定：同用户已确认节点中，scope.type 相同、有 id 时 id 也相同、且 subject 与任一主题词
  // （≥2 字符，按空白/逗号/句号分词）正则重叠的第一条。kind 不参与判定（跨类型主题重叠同样提示）。
  private async findConflict(userId: string, _kind: MemoryKind, subject: string, scope: MemoryScope): Promise<any | null> {
    const tokens = subject.split(/[\s,，。]+/).map((t) => t.trim()).filter((t) => t.length >= 2)
    if (tokens.length === 0) return null
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const docs = await this.memoryModel.find({
      userId: toObjectId(userId), status: 'confirmed',
      'scope.type': scope.type,
      ...(scope.id ? { 'scope.id': toObjectId(scope.id) } : {}),
      subject: { $regex: pattern, $options: 'i' },
    }).limit(3).lean().exec() as any[]
    return docs[0] ?? null
  }
}
