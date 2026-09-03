import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { MemoryEvidence, MemoryKind, MemoryScope } from './assistant.constants'
import { toObjectId } from './object-id.util'
import { AssistantMemory, AssistantMemoryDocument } from './schemas/assistant-memory.schema'
import { AssistantMemoryCandidate, AssistantMemoryCandidateDocument } from './schemas/assistant-memory-candidate.schema'
import { NoteChunk, NoteChunkDocument } from '../notes/schemas/note-chunk.schema'

// 长期记忆对外视图：scope/relation 等嵌套字段保留结构，ObjectId 统一转字符串。
export type MemoryView = {
  id: string; kind: MemoryKind; subject: string; statement: string; scope: MemoryScope
  status: 'confirmed' | 'superseded'; evidenceStatus: 'ok' | 'stale'; evidence: MemoryEvidence[]
  relation?: { type: string; targetMemoryId: string }
  validFrom?: string; validTo?: string; supersededById?: string; confirmedAt?: string; updatedAt: string
}

// 冲突解决动作；keep_both 可选带新范围：前端要求已调整新结论 scope（同 scope 后端拒绝）。
export type MemoryResolveAction =
  | { type: 'supersede'; targetMemoryId: string }
  | { type: 'keep_both'; scope?: MemoryScope }
  | { type: 'reject_memory' }

@Injectable()
export class MemoryService {
  constructor(
    @InjectModel(AssistantMemory.name) private readonly memoryModel: Model<AssistantMemoryDocument>,
    // T3 confirm 冲突时仅把候选置 confirmed、不写长期记忆（冲突挂起态），listPending/reject 均触达不到；
    // 本服务注入候选模型回溯该状态完成闭环：supersede 物化候选为记忆、reject_memory 退回 pending、
    // keep_both 换范围后物化。参数可选仅为兼容单模型直构测试（DI 正常注入）。
    @InjectModel(AssistantMemoryCandidate.name) private readonly candidateModel?: Model<AssistantMemoryCandidateDocument>,
    // refreshEvidence 校验 note_chunk 证据仍存在（笔记删除/重新索引后 chunk 消失即 stale）。
    // NoteChunk 未在本模块 forFeature 注册时为 undefined（guard 短路返回现状），直构测试注入 mock；@Optional 兼容缺失。
    @Optional() @InjectModel(NoteChunk.name) private readonly chunkModel?: Model<NoteChunkDocument>,
  ) {}

  async list(userId: string, opts?: { includeSuperseded?: boolean }) {
    const filter: any = { userId: toObjectId(userId) }
    if (!opts?.includeSuperseded) filter.status = 'confirmed'
    const docs = await this.memoryModel.find(filter).sort({ updatedAt: -1 }).limit(200).lean().exec() as any[]
    return docs.map((doc) => this.toView(doc))
  }

  // 演进视图：同 subject + scope 的全部节点（含已替代），按 validFrom 升序。
  async getTimeline(userId: string, subject: string, scope: MemoryScope) {
    const filter: any = {
      userId: toObjectId(userId), subject: String(subject || ''),
      'scope.type': scope?.type,
      ...(scope?.id ? { 'scope.id': toObjectId(scope.id) } : {}),
    }
    const docs = await this.memoryModel.find(filter).sort({ validFrom: 1 }).lean().exec() as any[]
    return docs.map((doc) => this.toView(doc))
  }

  // 冲突解决入口：优先按 memory 集合的 findOne 语义处理（plan 语义）；找不到记忆时回溯到
  // T3 confirm 冲突挂起的 confirmed 候选（resolve 端点由前端用候选 id 兜底发起，见 seam 闭环）。
  async resolveConflict(userId: string, memoryId: string, action: MemoryResolveAction) {
    const memory = await this.memoryModel.findOne({
      _id: toObjectId(memoryId), userId: toObjectId(userId), status: 'confirmed',
    }).lean().exec() as any
    if (memory) return this.resolveMemory(userId, memory, action)

    if (!this.candidateModel) throw new NotFoundException('memory not found')
    const candidate = await this.candidateModel.findOne({
      _id: toObjectId(memoryId), userId: toObjectId(userId), status: 'confirmed',
    }).lean().exec() as any
    if (!candidate) throw new NotFoundException('memory not found')
    return this.resolveHangingCandidate(userId, candidate, action)
  }

  // 物理删除；若它 supersedes 了旧节点，旧节点恢复 confirmed 并清空 supersededById/validTo。
  async delete(userId: string, memoryId: string) {
    const memory = await this.memoryModel.findOne({ _id: toObjectId(memoryId), userId: toObjectId(userId) }).lean().exec() as any
    if (!memory) return
    if (memory.relation?.type === 'supersedes' && memory.relation.targetMemoryId) {
      await this.memoryModel.updateOne(
        { _id: memory.relation.targetMemoryId, userId: toObjectId(userId) },
        { $unset: { supersededById: 1, validTo: 1 }, $set: { status: 'confirmed' } },
      ).exec()
    }
    await this.memoryModel.deleteOne({ _id: memory._id, userId: toObjectId(userId) }).exec()
  }

  // 证据复核：note_chunk 证据逐一校验对应 chunk 是否仍存在（笔记被删/重新索引后 chunk 会消失）。
  // 任一缺失 → 该记忆证据链已断，置 stale 并生成一条 hypothesis 复核候选（指向原节点，供用户重新确认）；
  // message 类型证据无法离线验证，保持现状；已 stale 的记忆复核不重复生成候选（evidenceKey review-<memoryId> 幂等）。
  async refreshEvidence(userId: string, memoryId: string): Promise<{ evidenceStatus: 'ok' | 'stale'; reviewCreated: boolean }> {
    const memory = await this.memoryModel.findOne({ _id: toObjectId(memoryId), userId: toObjectId(userId) }).lean().exec() as any
    if (!memory) throw new NotFoundException('memory not found')
    // chunkModel/candidateModel 未注入（模块未注册 NoteChunk / 单模型直构测试）时无法核验，返回现状不误报 stale。
    if (!this.chunkModel || !this.candidateModel) return { evidenceStatus: memory.evidenceStatus, reviewCreated: false }

    let stale = false
    for (const evidence of memory.evidence || []) {
      if (evidence.type !== 'note_chunk') continue
      const chunk = await this.chunkModel.findOne({
        _id: toObjectId(String(evidence.chunkId)), noteId: toObjectId(String(evidence.noteId)),
      }).select('_id').lean().exec() as any
      if (!chunk) stale = true
    }
    const evidenceStatus: 'ok' | 'stale' = stale ? 'stale' : 'ok'
    if (stale && memory.evidenceStatus !== 'stale') {
      await this.memoryModel.updateOne({ _id: memory._id }, { $set: { evidenceStatus: 'stale' } }).exec()
      await this.candidateModel.create({
        userId: memory.userId, conversationId: memory.conversationId || memory.userId,
        kind: 'hypothesis', subject: memory.subject, statement: `复核认知：${memory.statement}（原证据可能已变化）`,
        scope: memory.scope, confidence: Math.max(0.1, Number(memory.confidence) * 0.8),
        evidence: [{ type: 'message', messageId: memory.candidateId || memory._id, excerpt: memory.statement.slice(0, 160) }],
        evidenceKey: `review-${memory._id}`,
      })
      return { evidenceStatus: 'stale', reviewCreated: true }
    }
    return { evidenceStatus, reviewCreated: false }
  }

  // 认知导出：全部记忆（含 superseded）按 createdAt 升序输出 NDJSON 行（evidence 一并序列化）。
  async exportJsonl(userId: string): Promise<string> {
    const docs = await this.memoryModel.find({ userId: toObjectId(userId) }).sort({ createdAt: 1 }).lean().exec() as any[]
    return docs.map((doc) => JSON.stringify({
      id: String(doc._id), kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope,
      status: doc.status, evidenceStatus: doc.evidenceStatus, evidence: doc.evidence || [],
      validFrom: doc.validFrom ? String(doc.validFrom) : undefined,
      validTo: doc.validTo ? String(doc.validTo) : undefined,
      confirmedAt: doc.confirmedAt ? String(doc.confirmedAt) : undefined,
    })).join('\n')
  }

  // 记忆级解决：supersede 只对仍 confirmed 的目标生效并给新节点补 supersedes 关系；
  // keep_both 校验（可选先落新范围）后放行；reject_memory 删除记忆并把来源候选退回 pending。
  private async resolveMemory(userId: string, memory: any, action: MemoryResolveAction) {
    if (action.type === 'supersede') {
      const target = await this.memoryModel.findOneAndUpdate(
        { _id: toObjectId(action.targetMemoryId), userId: toObjectId(userId), status: 'confirmed' },
        { $set: { status: 'superseded', validTo: new Date(), supersededById: memory._id } },
        { new: true },
      ).lean().exec() as any
      if (!target) {
        // 目标不存在或已 superseded：若正是被本节点替代（同一 supersede 重放，如双击/候选幂等回放），
        // 视为已解决直接返回，绝不二次写入 validTo 改写演进时间；否则目标缺失报 not found。
        const replayed = await this.memoryModel.findOne({
          _id: toObjectId(action.targetMemoryId), userId: toObjectId(userId),
          status: 'superseded', supersededById: memory._id,
        }).lean().exec() as any
        if (!replayed) throw new NotFoundException('target memory not found')
        return { status: 'superseded' }
      }
      await this.memoryModel.updateOne(
        { _id: memory._id },
        { $set: { relation: { type: 'supersedes', targetMemoryId: target._id } } },
      ).exec()
      return { status: 'superseded' }
    }

    if (action.type === 'keep_both') {
      const nextScope = action.scope ?? memory.scope
      const conflict = await this.findScopeConflict(userId, { _id: memory._id, subject: memory.subject, scope: nextScope })
      if (conflict) throw new BadRequestException('keep_both 需先调整新结论的 scope，仍与既有认知同范围重叠')
      if (action.scope) {
        await this.memoryModel.updateOne({ _id: memory._id }, { $set: { scope: action.scope } }).exec()
      }
      return { status: 'kept' }
    }

    // reject_memory：删除新确认的记忆，对应候选退回 pending 供修改后重提；
    // 若该记忆 supersedes 了旧节点，与 delete 语义对称地恢复旧节点为 confirmed（撤销替代）。
    if (memory.relation?.type === 'supersedes' && memory.relation.targetMemoryId) {
      await this.memoryModel.updateOne(
        { _id: memory.relation.targetMemoryId, userId: toObjectId(userId) },
        { $unset: { supersededById: 1, validTo: 1 }, $set: { status: 'confirmed' } },
      ).exec()
    }
    if (memory.candidateId) {
      await this.candidateModel?.updateOne(
        { _id: memory.candidateId, userId: toObjectId(userId) },
        { $set: { status: 'pending' }, $unset: { rejectionReason: 1 } },
      ).exec()
    }
    await this.memoryModel.deleteOne({ _id: memory._id, userId: toObjectId(userId) }).exec()
    return { status: 'rejected' }
  }

  // 候选级解决（冲突挂起候选）：先检查候选是否已物化（防重复提交重复建记忆），
  // 是则转到记忆级语义；否则 supersede/keep_both 物化候选、reject_memory 直接退回 pending。
  private async resolveHangingCandidate(userId: string, candidate: any, action: MemoryResolveAction) {
    const materialized = await this.memoryModel.findOne({ candidateId: candidate._id, userId: toObjectId(userId) }).lean().exec() as any
    if (materialized) return this.resolveMemory(userId, materialized, action)

    if (action.type === 'supersede') {
      // 先校验替代目标存在（避免物化后才失败留下孤儿记忆）。
      const target = await this.memoryModel.findOne({
        _id: toObjectId(action.targetMemoryId), userId: toObjectId(userId), status: 'confirmed',
      }).lean().exec() as any
      if (!target) throw new NotFoundException('target memory not found')
      const created = await this.memoryModel.create({
        userId: toObjectId(userId), conversationId: candidate.conversationId, kind: candidate.kind,
        subject: candidate.subject, statement: candidate.statement, scope: candidate.scope,
        status: 'confirmed', confidence: Number(candidate.confidence), evidence: candidate.evidence || [],
        evidenceStatus: 'ok', validFrom: new Date(), confirmedAt: new Date(), candidateId: candidate._id,
      }) as any
      await this.memoryModel.updateOne(
        { _id: toObjectId(action.targetMemoryId), userId: toObjectId(userId) },
        { $set: { status: 'superseded', validTo: new Date(), supersededById: created._id } },
      ).exec()
      await this.memoryModel.updateOne(
        { _id: created._id },
        { $set: { relation: { type: 'supersedes', targetMemoryId: toObjectId(action.targetMemoryId) } } },
      ).exec()
      return { status: 'superseded' }
    }

    if (action.type === 'keep_both') {
      const nextScope = action.scope ?? candidate.scope
      const conflict = await this.findScopeConflict(userId, { subject: candidate.subject, scope: nextScope })
      if (conflict) throw new BadRequestException('keep_both 需先调整新结论的 scope，仍与既有认知同范围重叠')
      await this.candidateModel!.updateOne({ _id: candidate._id }, { $set: { scope: nextScope } }).exec()
      await this.memoryModel.create({
        userId: toObjectId(userId), conversationId: candidate.conversationId, kind: candidate.kind,
        subject: candidate.subject, statement: candidate.statement, scope: nextScope,
        status: 'confirmed', confidence: Number(candidate.confidence), evidence: candidate.evidence || [],
        evidenceStatus: 'ok', validFrom: new Date(), confirmedAt: new Date(), candidateId: candidate._id,
      })
      return { status: 'kept' }
    }

    // reject_memory：挂起候选没有对应记忆行，直接退回 pending 供修改后重提。
    await this.candidateModel!.updateOne(
      { _id: candidate._id, userId: toObjectId(userId) },
      { $set: { status: 'pending' }, $unset: { rejectionReason: 1 } },
    ).exec()
    return { status: 'rejected' }
  }

  // 同 scope + 主题词重叠的已确认节点判定，与候选确认的冲突检测同构（T3 findConflict）。
  private async findScopeConflict(userId: string, self: { _id?: any; subject: string; scope: MemoryScope }) {
    const tokens = String(self.subject || '').split(/[\s,，。]+/).map((t) => t.trim()).filter((t) => t.length >= 2)
    if (tokens.length === 0) return null
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const docs = await this.memoryModel.find({
      userId: toObjectId(userId), status: 'confirmed',
      'scope.type': self.scope?.type,
      ...(self.scope?.id ? { 'scope.id': toObjectId(self.scope.id) } : {}),
      ...(self._id ? { _id: { $ne: self._id } } : {}),
      subject: { $regex: pattern, $options: 'i' },
    }).limit(3).lean().exec() as any[]
    return docs[0] ?? null
  }

  private toView(doc: any): MemoryView {
    return {
      id: String(doc._id), kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope,
      status: doc.status, evidenceStatus: doc.evidenceStatus, evidence: doc.evidence || [],
      relation: doc.relation ? { type: doc.relation.type, targetMemoryId: String(doc.relation.targetMemoryId) } : undefined,
      validFrom: doc.validFrom ? String(doc.validFrom) : undefined,
      validTo: doc.validTo ? String(doc.validTo) : undefined,
      supersededById: doc.supersededById ? String(doc.supersededById) : undefined,
      confirmedAt: doc.confirmedAt ? String(doc.confirmedAt) : undefined,
      updatedAt: String(doc.updatedAt || new Date().toISOString()),
    }
  }
}
