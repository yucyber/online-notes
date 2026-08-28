import { Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteChunk, NoteChunkDocument } from '../notes/schemas/note-chunk.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { AddKnowledgeBaseNoteDto, CreateKnowledgeBaseDto, SaveKnowledgeGraphDto } from './dto'
import {
  clampUnitInterval,
  normalizeKnowledgeGraphNodeType,
  normalizeKnowledgeGraphNoteIds,
  resolveKnowledgeGraphEdgeNoteIds,
  uniqueStrings,
} from './knowledge-graph-normalize'
import { KnowledgeGraphService } from './knowledge-graph.service'
import { KnowledgeBase, KnowledgeBaseDocument } from './schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteDocument } from './schemas/knowledge-base-note.schema'
import { KnowledgeGraphEdge, KnowledgeGraphEdgeDocument } from './schemas/knowledge-graph-edge.schema'
import { KnowledgeGraphNode, KnowledgeGraphNodeDocument } from './schemas/knowledge-graph-node.schema'

@Injectable()
export class KnowledgeBasesService {
  constructor(
    @InjectModel(KnowledgeBase.name) private readonly kbModel: Model<KnowledgeBaseDocument>,
    @InjectModel(KnowledgeBaseNote.name) private readonly kbNoteModel: Model<KnowledgeBaseNoteDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly noteAccess: NoteAccessService,
    @Optional() @InjectModel(KnowledgeGraphNode.name) private readonly graphNodeModel?: Model<KnowledgeGraphNodeDocument>,
    @Optional() @InjectModel(KnowledgeGraphEdge.name) private readonly graphEdgeModel?: Model<KnowledgeGraphEdgeDocument>,
    @Optional() private readonly injectedGraphService?: KnowledgeGraphService,
    @Optional() @InjectModel(NoteChunk.name) private readonly noteChunkModel?: Model<NoteChunkDocument>,
  ) {
    this.graphService = injectedGraphService || new KnowledgeGraphService()
  }

  private readonly graphService: KnowledgeGraphService

  async create(input: CreateKnowledgeBaseDto, userId: string) {
    const created = await this.kbModel.create({
      name: this.cleanName(input.name),
      description: this.cleanDescription(input.description),
      userId: this.objectId(userId, 'user id'),
    })

    return this.serializeKnowledgeBase(created)
  }

  async findAll(userId: string) {
    const docs = await this.kbModel
      .find({ userId: this.objectId(userId, 'user id') })
      .sort({ createdAt: -1 })
      .exec()

    return docs.map((doc) => this.serializeKnowledgeBase(doc))
  }

  async addNote(id: string, noteId: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    // 知识库归当前用户所有，但其中可以引用该用户有权读取的共享或公开笔记。
    const note = await this.noteModel
      .findOne(this.noteAccess.readScope(noteId, userId))
      .select('title updatedAt createdAt')
      .exec()

    if (!note) throw new NotFoundException('Note not found or not readable')

    const userObjectId = this.objectId(userId, 'user id')
    const knowledgeBaseId = this.idOf(kb)
    const noteObjectId = this.idOf(note)
    const link = await this.kbNoteModel.findOneAndUpdate(
      { knowledgeBaseId, noteId: noteObjectId, userId: userObjectId },
      { $setOnInsert: { knowledgeBaseId, noteId: noteObjectId, userId: userObjectId } },
      { new: true, upsert: true },
    ).exec()

    return this.serializeKnowledgeBaseNote(link, note)
  }

  async addNoteFromDto(id: string, input: AddKnowledgeBaseNoteDto, userId: string) {
    return this.addNote(id, input.noteId, userId)
  }

  async listNotes(id: string, userId: string) {
    const { links, noteById } = await this.listLinkedNotes(id, userId, { includeContent: false })
    return links
      .map((link) => {
        const note = noteById.get(String(this.idOf(link, 'noteId')))
        return note ? this.serializeKnowledgeBaseNote(link, note) : null
      })
      .filter(Boolean)
  }

  async listGraphNotes(id: string, userId: string) {
    const { links, noteById } = await this.listLinkedNotes(id, userId, { includeContent: true })
    const readableNoteIds = [...noteById.keys()].map((noteId) => new Types.ObjectId(noteId))
    const chunks = readableNoteIds.length > 0 && this.noteChunkModel
      ? await this.noteChunkModel.find({ userId: this.objectId(userId, 'user id'), noteId: { $in: readableNoteIds } })
        .sort({ noteId: 1, chunkIndex: 1 }).select('noteId headingPath content').exec()
      : []
    const chunksByNote = new Map<string, any[]>()
    for (const chunk of chunks) {
      const chunkValue = this.toObject(chunk)
      const noteId = String(this.idOf(chunk, 'noteId'))
      chunksByNote.set(noteId, [...(chunksByNote.get(noteId) || []), {
        chunkId: String(this.idOf(chunk)),
        headingPath: chunkValue.headingPath || [],
        content: chunkValue.content || '',
      }])
    }
    return links
      .map((link) => {
        const note = noteById.get(String(this.idOf(link, 'noteId')))
        if (!note) return null
        const value = this.toObject(note)
        return {
          id: String(value._id),
          title: value.title || 'Untitled',
          summary: value.summary || '',
          chunks: chunksByNote.get(String(value._id)) || [],
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
        }
      })
      .filter(Boolean)
  }

  async getGraph(id: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    const scope = {
      knowledgeBaseId: this.idOf(kb),
      userId: this.objectId(userId, 'user id'),
    }
    const [nodes, edges] = await Promise.all([
      this.requireGraphNodeModel().find(scope).sort({ createdAt: 1 }).exec(),
      this.requireGraphEdgeModel().find(scope).sort({ createdAt: 1 }).exec(),
    ])

    return {
      knowledgeBaseId: String(scope.knowledgeBaseId),
      generatedAt: this.latestGraphTimestamp(nodes, edges),
      nodes: nodes.map((node) => this.serializeKnowledgeGraphNode(node)),
      edges: edges.map((edge) => this.serializeKnowledgeGraphEdge(edge)),
      warnings: [],
    }
  }

  async replaceGraph(id: string, input: SaveKnowledgeGraphDto, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    const knowledgeBaseId = this.idOf(kb)
    const userObjectId = this.objectId(userId, 'user id')
    const scope = { knowledgeBaseId, userId: userObjectId }
    const linkedNoteIds = await this.listKnowledgeBaseNoteIds(knowledgeBaseId, userObjectId)
    const readableNotes = linkedNoteIds.length > 0
      ? await this.noteModel.find(this.noteAccess.readableNotesQuery(linkedNoteIds, userId)).select('_id').exec()
      : []
    const allowedNoteIds = readableNotes.map((note) => this.idOf(note))
    const allowedNoteIdSet = new Set(allowedNoteIds.map(String))
    const evidenceById = await this.loadValidEvidence(input, userObjectId, allowedNoteIds)
    const nodes = this.normalizeGraphNodes(input?.nodes || [], scope, allowedNoteIdSet, evidenceById)
    const nodeIds = new Set(nodes.map((node) => node.nodeId))
    const nodeNoteIds = new Map(nodes.map((node) => [node.nodeId, node.noteIds.map(String)]))
    const edges = this.normalizeGraphEdges(input?.edges || [], scope, allowedNoteIdSet, nodeIds, nodeNoteIds, evidenceById)

    return this.graphService.replace({
      connectionOwner: this.kbModel,
      scope,
      nodes,
      edges,
      nodeModel: this.requireGraphNodeModel(),
      edgeModel: this.requireGraphEdgeModel(),
      serialize: (savedNodes, savedEdges) => ({
        knowledgeBaseId: String(knowledgeBaseId),
        generatedAt: this.latestGraphTimestamp(savedNodes, savedEdges),
        nodes: savedNodes.map((node) => this.serializeKnowledgeGraphNode(node)),
        edges: savedEdges.map((edge) => this.serializeKnowledgeGraphEdge(edge)),
        warnings: [],
      }),
    })
  }

  async removeNote(id: string, noteId: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    await this.kbNoteModel.deleteOne({
      knowledgeBaseId: this.idOf(kb),
      noteId: this.objectId(noteId, 'note id'),
      userId: this.objectId(userId, 'user id'),
    }).exec()
    return { ok: true }
  }

  private async listLinkedNotes(id: string, userId: string, opts: { includeContent: boolean }) {
    const kb = await this.requireKnowledgeBase(id, userId)
    const userObjectId = this.objectId(userId, 'user id')
    const links = await this.kbNoteModel
      .find({ knowledgeBaseId: this.idOf(kb), userId: userObjectId })
      .sort({ createdAt: -1 })
      .exec()

    const noteIds = links.map((link) => this.idOf(link, 'noteId'))
    if (noteIds.length === 0) {
      return { links, noteById: new Map<string, any>() }
    }

    const select = opts.includeContent
      ? 'title summary content updatedAt createdAt'
      : 'title summary updatedAt createdAt'
    // 关联创建后权限可能变化，因此每次读取都重新套用 NoteAccessService，并自然过滤已失权笔记。
    const notes = await this.noteModel
      .find(this.noteAccess.readableNotesQuery(noteIds, userId))
      .select(select)
      .exec()
    const noteById = new Map(notes.map((note) => [String(this.idOf(note)), note]))
    return { links, noteById }
  }

  private async listKnowledgeBaseNoteIds(knowledgeBaseId: Types.ObjectId, userId: Types.ObjectId) {
    const links = await this.kbNoteModel
      .find({ knowledgeBaseId, userId })
      .sort({ createdAt: -1 })
      .exec()
    return links.map((link) => this.idOf(link, 'noteId'))
  }

  private normalizeGraphNodes(nodes: SaveKnowledgeGraphDto['nodes'], scope: { knowledgeBaseId: Types.ObjectId; userId: Types.ObjectId }, allowedNoteIds: Set<string>, evidenceById: Map<string, string>) {
    // 图谱节点只能引用当前知识库已关联的笔记，不能借保存图谱写入任意 noteId。
    const seen = new Set<string>()
    return (Array.isArray(nodes) ? nodes : []).flatMap((node) => {
      const nodeId = this.cleanGraphId(node?.id, 160)
      const label = this.cleanText(node?.label, 160)
      const noteIds = normalizeKnowledgeGraphNoteIds(node?.noteIds, allowedNoteIds)
      if (!nodeId || !label || noteIds.length === 0 || seen.has(nodeId)) return []
      seen.add(nodeId)
      return [{
        ...scope,
        nodeId,
        label,
        type: normalizeKnowledgeGraphNodeType(node?.type),
        confidence: clampUnitInterval(node?.confidence, 0.75),
        noteIds: noteIds.map((noteId) => new Types.ObjectId(noteId)),
        evidenceChunkIds: this.filterEvidenceIds(node?.evidenceChunkIds, evidenceById, new Set(noteIds)).map((chunkId) => new Types.ObjectId(chunkId)),
      }]
    })
  }

  private normalizeGraphEdges(
    edges: SaveKnowledgeGraphDto['edges'],
    scope: { knowledgeBaseId: Types.ObjectId; userId: Types.ObjectId },
    allowedNoteIds: Set<string>,
    nodeIds: Set<string>,
    nodeNoteIds: Map<string, string[]>,
    evidenceById: Map<string, string>,
  ) {
    // 边必须连接本次提交中存在的节点；缺少 noteIds 时才继承两端节点的来源笔记。
    const seen = new Set<string>()
    return (Array.isArray(edges) ? edges : []).flatMap((edge) => {
      const source = this.cleanGraphId(edge?.source, 160)
      const target = this.cleanGraphId(edge?.target, 160)
      if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) return []
      const relation = this.cleanText(edge?.relation, 120) || 'related to'
      const edgeId = this.cleanGraphId(edge?.id, 200) || `${source}:${target}:${relation}`
      if (seen.has(edgeId)) return []
      const fallbackNoteIds = uniqueStrings([...(nodeNoteIds.get(source) || []), ...(nodeNoteIds.get(target) || [])])
      const noteIds = resolveKnowledgeGraphEdgeNoteIds(edge?.noteIds, allowedNoteIds, fallbackNoteIds)
      if (noteIds.length === 0) return []
      seen.add(edgeId)
      return [{
        ...scope,
        edgeId,
        source,
        target,
        relation,
        weight: clampUnitInterval(edge?.weight, 0.6),
        noteIds: noteIds.map((noteId) => new Types.ObjectId(noteId)),
        // 边证据限定在两端节点的笔记并集，避免合法 Chunk ID 被借用到无关关系。
        evidenceChunkIds: this.filterEvidenceIds(edge?.evidenceChunkIds, evidenceById, new Set(fallbackNoteIds)).map((chunkId) => new Types.ObjectId(chunkId)),
      }]
    })
  }

  private async requireKnowledgeBase(id: string, userId: string) {
    const kb = await this.kbModel.findOne({
      _id: this.objectId(id, 'knowledge base id'),
      userId: this.objectId(userId, 'user id'),
    }).exec()
    if (!kb) throw new NotFoundException('Knowledge base not found')
    return kb
  }

  private serializeKnowledgeBase(doc: any) {
    const value = this.toObject(doc)
    return {
      id: String(value._id),
      name: value.name,
      description: value.description || '',
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  }

  private serializeKnowledgeBaseNote(link: any, note: any) {
    const linkValue = this.toObject(link)
    const noteValue = this.toObject(note)
    return {
      id: String(linkValue._id),
      knowledgeBaseId: String(linkValue.knowledgeBaseId),
      noteId: String(linkValue.noteId),
      note: {
        id: String(noteValue._id),
        title: noteValue.title || 'Untitled',
        summary: noteValue.summary,
        createdAt: noteValue.createdAt,
        updatedAt: noteValue.updatedAt,
      },
      createdAt: linkValue.createdAt,
    }
  }

  private serializeKnowledgeGraphNode(node: any) {
    const value = this.toObject(node)
    return {
      id: String(value.nodeId),
      label: value.label,
      type: normalizeKnowledgeGraphNodeType(value.type),
      confidence: clampUnitInterval(value.confidence, 0.75),
      noteIds: (Array.isArray(value.noteIds) ? value.noteIds : []).map(String),
      evidenceChunkIds: (Array.isArray(value.evidenceChunkIds) ? value.evidenceChunkIds : []).map(String),
    }
  }

  private serializeKnowledgeGraphEdge(edge: any) {
    const value = this.toObject(edge)
    return {
      id: String(value.edgeId),
      source: String(value.source),
      target: String(value.target),
      relation: value.relation || 'related to',
      weight: clampUnitInterval(value.weight, 0.6),
      noteIds: (Array.isArray(value.noteIds) ? value.noteIds : []).map(String),
      evidenceChunkIds: (Array.isArray(value.evidenceChunkIds) ? value.evidenceChunkIds : []).map(String),
    }
  }

  private async loadValidEvidence(input: SaveKnowledgeGraphDto, userId: Types.ObjectId, allowedNoteIds: Types.ObjectId[]) {
    const candidateIds = uniqueStrings([...(input?.nodes || []), ...(input?.edges || [])]
      .flatMap((item) => Array.isArray(item?.evidenceChunkIds) ? item.evidenceChunkIds : [])
      .map(String)
      .filter((id) => Types.ObjectId.isValid(id)))
    if (candidateIds.length === 0) return new Map<string, string>()
    const chunks = await this.requireNoteChunkModel().find({
      _id: { $in: candidateIds.map((id) => new Types.ObjectId(id)) },
      userId,
      noteId: { $in: allowedNoteIds },
    }).select('_id noteId userId').exec()
    return new Map(chunks.map((chunk) => [String(this.idOf(chunk)), String(this.idOf(chunk, 'noteId'))]))
  }

  private filterEvidenceIds(value: unknown, evidenceById: Map<string, string>, allowedNoteIds: Set<string>) {
    return uniqueStrings((Array.isArray(value) ? value : []).map(String).filter((id) => {
      const noteId = evidenceById.get(id)
      return Boolean(noteId && allowedNoteIds.has(noteId))
    }))
  }

  private latestGraphTimestamp(nodes: any[], edges: any[]) {
    const timestamps = [...(nodes || []), ...(edges || [])]
      .map((item) => this.toObject(item)?.updatedAt || this.toObject(item)?.createdAt)
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
    if (timestamps.length === 0) return new Date().toISOString()
    return new Date(Math.max(...timestamps)).toISOString()
  }

  private toObject(doc: any) {
    return typeof doc?.toObject === 'function' ? doc.toObject() : doc
  }

  private idOf(doc: any, field = '_id'): Types.ObjectId {
    const value = this.toObject(doc)?.[field]
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value))
  }

  private objectId(id: string, label: string) {
    return this.noteAccess.objectId(id, label)
  }

  private cleanName(value: string) {
    return String(value || '').trim()
  }

  private cleanDescription(value?: string) {
    return String(value || '').trim()
  }

  private cleanGraphId(value: unknown, maxLength: number) {
    return String(value || '').trim().slice(0, maxLength)
  }

  private cleanText(value: unknown, maxLength: number) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
  }

  private requireGraphNodeModel() {
    if (!this.graphNodeModel) throw new Error('Knowledge graph node model is not configured')
    return this.graphNodeModel
  }

  private requireGraphEdgeModel() {
    if (!this.graphEdgeModel) throw new Error('Knowledge graph edge model is not configured')
    return this.graphEdgeModel
  }

  private requireNoteChunkModel() {
    if (!this.noteChunkModel) throw new Error('Note chunk model is not configured')
    return this.noteChunkModel
  }

}
