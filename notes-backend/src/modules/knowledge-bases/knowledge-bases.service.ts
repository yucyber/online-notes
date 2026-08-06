import { Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { AddKnowledgeBaseNoteDto, CreateKnowledgeBaseDto, SaveKnowledgeGraphDto, UpdateKnowledgeBaseDto } from './dto'
import {
  clampUnitInterval,
  normalizeKnowledgeGraphNodeType,
  normalizeKnowledgeGraphNoteIds,
  resolveKnowledgeGraphEdgeNoteIds,
  uniqueStrings,
} from './knowledge-graph-normalize'
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
  ) {}

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

  async update(id: string, input: UpdateKnowledgeBaseDto, userId: string) {
    const $set: Record<string, unknown> = {}
    if (input.name !== undefined) $set.name = this.cleanName(input.name)
    if (input.description !== undefined) $set.description = this.cleanDescription(input.description)

    const doc = await this.kbModel.findOneAndUpdate(
      { _id: this.objectId(id, 'knowledge base id'), userId: this.objectId(userId, 'user id') },
      { $set },
      { new: true },
    ).exec()
    if (!doc) throw new NotFoundException('Knowledge base not found')

    return this.serializeKnowledgeBase(doc)
  }

  async remove(id: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    await this.kbNoteModel.deleteMany({ knowledgeBaseId: this.idOf(kb), userId: this.objectId(userId, 'user id') }).exec()
    await this.kbModel.deleteOne({ _id: this.idOf(kb), userId: this.objectId(userId, 'user id') }).exec()
    return { ok: true }
  }

  async addNote(id: string, noteId: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
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
    return links
      .map((link) => {
        const note = noteById.get(String(this.idOf(link, 'noteId')))
        if (!note) return null
        const value = this.toObject(note)
        return {
          id: String(value._id),
          title: value.title || 'Untitled',
          summary: value.summary || '',
          content: value.content || '',
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
    const allowedNoteIds = await this.listKnowledgeBaseNoteIds(knowledgeBaseId, userObjectId)
    const allowedNoteIdSet = new Set(allowedNoteIds.map(String))
    const nodes = this.normalizeGraphNodes(input?.nodes || [], scope, allowedNoteIdSet)
    const nodeIds = new Set(nodes.map((node) => node.nodeId))
    const nodeNoteIds = new Map(nodes.map((node) => [node.nodeId, node.noteIds.map(String)]))
    const edges = this.normalizeGraphEdges(input?.edges || [], scope, allowedNoteIdSet, nodeIds, nodeNoteIds)

    await this.requireGraphEdgeModel().deleteMany(scope).exec()
    await this.requireGraphNodeModel().deleteMany(scope).exec()

    const savedNodes = nodes.length > 0 ? await this.requireGraphNodeModel().insertMany(nodes) : []
    const savedEdges = edges.length > 0 ? await this.requireGraphEdgeModel().insertMany(edges) : []

    return {
      knowledgeBaseId: String(knowledgeBaseId),
      generatedAt: this.latestGraphTimestamp(savedNodes, savedEdges),
      nodes: savedNodes.map((node) => this.serializeKnowledgeGraphNode(node)),
      edges: savedEdges.map((edge) => this.serializeKnowledgeGraphEdge(edge)),
      warnings: [],
    }
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

  private normalizeGraphNodes(nodes: SaveKnowledgeGraphDto['nodes'], scope: { knowledgeBaseId: Types.ObjectId; userId: Types.ObjectId }, allowedNoteIds: Set<string>) {
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
      }]
    })
  }

  private normalizeGraphEdges(
    edges: SaveKnowledgeGraphDto['edges'],
    scope: { knowledgeBaseId: Types.ObjectId; userId: Types.ObjectId },
    allowedNoteIds: Set<string>,
    nodeIds: Set<string>,
    nodeNoteIds: Map<string, string[]>,
  ) {
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
    }
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
}
