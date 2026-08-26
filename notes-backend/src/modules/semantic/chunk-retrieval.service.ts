import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { NoteAccessService } from '../notes/note-access.service'
import { NoteChunk, NoteChunkDocument } from '../notes/schemas/note-chunk.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteDocument } from '../knowledge-bases/schemas/knowledge-base-note.schema'
import { EmbeddingService } from './embedding.service'

export interface ChunkSearchInput {
  query: string
  knowledgeBaseId?: string
  noteIds?: string[]
  limit?: number
}

export interface ChunkSearchResult {
  chunkId: string
  noteId: string
  title: string
  headingPath: string[]
  content: string
  score: number
}

@Injectable()
export class ChunkRetrievalService {
  constructor(
    @InjectModel(NoteChunk.name) private readonly chunkModel: Model<NoteChunkDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(KnowledgeBaseNote.name) private readonly kbNoteModel: Model<KnowledgeBaseNoteDocument>,
    private readonly noteAccess: NoteAccessService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async searchChunks(input: ChunkSearchInput, userId: string): Promise<ChunkSearchResult[]> {
    const query = String(input.query || '').trim()
    const limit = Math.max(1, Math.min(50, Number(input.limit || 8)))
    if (!query) return []

    const requestedIds = await this.resolveRequestedNoteIds(input, userId)
    if (requestedIds && requestedIds.length === 0) return []
    const readableAnd: any[] = [this.noteAccess.readableFilter(userId)]
    if (requestedIds) readableAnd.push({ _id: { $in: requestedIds } })
    const readableNotes = await this.noteModel
      .find({ $and: readableAnd })
      .select('_id')
      .lean()
      .exec()
    const allowedIds = readableNotes.map((note: any) => note._id as Types.ObjectId)
    if (allowedIds.length === 0) return []

    const vector = await this.embeddingService.generateEmbedding(query)
    if (!vector?.length) return []
    const candidates = await this.chunkModel.aggregate([
      {
        $vectorSearch: {
          index: 'note_chunk_vector_index',
          path: 'embedding',
          queryVector: vector,
          filter: { noteId: { $in: allowedIds } },
          numCandidates: Math.max(100, limit * 20),
          limit: Math.min(200, limit * 5),
        },
      },
      { $match: { noteId: { $in: allowedIds } } },
      {
        $project: {
          noteId: 1,
          headingPath: 1,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]).exec()

    // Atlas filter 与后置 $match 都只使用服务端算出的 allowlist；再次在内存过滤用于防御索引配置漂移。
    const allowed = new Set(allowedIds.map(String))
    const safeCandidates = candidates.filter((chunk: any) => allowed.has(String(chunk.noteId))).slice(0, limit)
    const titleDocs = await this.noteModel
      .find({ _id: { $in: safeCandidates.map((chunk: any) => chunk.noteId) } })
      .select('_id title')
      .lean()
      .exec()
    const titles = new Map(titleDocs.map((note: any) => [String(note._id), String(note.title || '')]))

    return safeCandidates.map((chunk: any) => ({
      chunkId: String(chunk._id),
      noteId: String(chunk.noteId),
      title: titles.get(String(chunk.noteId)) || '',
      headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath.map(String) : [],
      content: String(chunk.content || ''),
      score: Number(chunk.score || 0),
    }))
  }

  private async resolveRequestedNoteIds(input: ChunkSearchInput, userId: string): Promise<Types.ObjectId[] | undefined> {
    let ids = input.noteIds?.map((id) => new Types.ObjectId(id))
    if (input.knowledgeBaseId) {
      const links = await this.kbNoteModel
        .find({
          knowledgeBaseId: new Types.ObjectId(input.knowledgeBaseId),
          userId: new Types.ObjectId(userId),
        })
        .select('noteId')
        .lean()
        .exec()
      const linked = links.map((link: any) => link.noteId as Types.ObjectId)
      if (ids) {
        const requested = new Set(ids.map(String))
        ids = linked.filter((id) => requested.has(String(id)))
      } else {
        ids = linked
      }
    }
    return ids
  }
}
