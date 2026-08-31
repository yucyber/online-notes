import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { EmbeddingService } from '../semantic/embedding.service'
import { NoteChunkerService } from './note-chunker.service'
import { Note, NoteDocument } from './schemas/note.schema'
import { NoteChunk, NoteChunkDocument } from './schemas/note-chunk.schema'

export const CHUNK_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B'
export const CHUNK_STRATEGY_VERSION = 'heading-aware-v1'

export interface NoteChunkSourceSnapshot {
  noteId: string
  userId: string
  title: string
  content: string
  expectedUpdatedAt: Date
}

export interface NoteChunkRefreshResult {
  total: number
  reused: number
  embedded: number
  removed: number
  failed: number
  stale: boolean
}

@Injectable()
export class NoteChunkIndexService {
  constructor(
    @InjectModel(NoteChunk.name) private readonly chunkModel: Model<NoteChunkDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly chunker: NoteChunkerService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async refreshNoteChunks(snapshot: NoteChunkSourceSnapshot): Promise<NoteChunkRefreshResult> {
    // 统一按 schema 声明存储为 ObjectId：读取方（图谱证据、语义检索）都用 ObjectId 查询，避免字符串/对象类型不一致导致永远匹配不到。
    const noteId = new Types.ObjectId(String(snapshot.noteId))
    const userId = new Types.ObjectId(String(snapshot.userId))
    const built = this.chunker.buildChunks({ title: snapshot.title, content: snapshot.content })
    const existing = await this.chunkModel
      .find({ userId, noteId })
      .lean()
      .exec()
    const byHash = new Map(existing.map((chunk: any) => [String(chunk.contentHash), chunk]))
    const prepared: Array<any> = []
    let reused = 0
    let embedded = 0

    for (const chunk of built) {
      const previous: any = byHash.get(chunk.contentHash)
      let embedding = previous?.embedding
      if (Array.isArray(embedding) && embedding.length > 0) {
        reused++
      } else {
        const source = [
          snapshot.title,
          chunk.headingPath.join(' > '),
          chunk.content,
        ].filter(Boolean).join('\n')
        embedding = await this.embeddingService.generateEmbedding(source)
        if (!embedding?.length) {
          return { total: built.length, reused, embedded, removed: 0, failed: 1, stale: false }
        }
        embedded++
      }
      prepared.push({ ...chunk, embedding, previous })
    }

    // embedding 全部生成后再核对业务版本；过期任务不会触碰上一版有效 chunks。
    const current = await this.noteModel.exists({
      _id: snapshot.noteId,
      updatedAt: snapshot.expectedUpdatedAt,
    })
    if (!current) {
      return { total: built.length, reused, embedded, removed: 0, failed: 0, stale: true }
    }

    const operations: any[] = []
    for (const chunk of prepared) {
      const unchangedAtPosition = chunk.previous
        && Number(chunk.previous.chunkIndex) === chunk.chunkIndex
        && String(chunk.previous.contentHash) === chunk.contentHash
        && chunk.previous.embeddingModel === CHUNK_EMBEDDING_MODEL
        && chunk.previous.chunkStrategyVersion === CHUNK_STRATEGY_VERSION
      if (unchangedAtPosition) continue
      operations.push({
        replaceOne: {
          filter: { userId, noteId, chunkIndex: chunk.chunkIndex },
          replacement: {
            userId,
            noteId,
            chunkIndex: chunk.chunkIndex,
            headingPath: chunk.headingPath,
            content: chunk.content,
            contentHash: chunk.contentHash,
            embedding: chunk.embedding,
            embeddingModel: CHUNK_EMBEDDING_MODEL,
            chunkStrategyVersion: CHUNK_STRATEGY_VERSION,
          },
          upsert: true,
        },
      })
    }

    const removed = existing.filter((chunk: any) => Number(chunk.chunkIndex) >= built.length).length
    if (removed > 0) {
      operations.push({
        deleteMany: {
          filter: { userId, noteId, chunkIndex: { $gte: built.length } },
        },
      })
    }
    if (operations.length > 0) await this.chunkModel.bulkWrite(operations, { ordered: true })

    return { total: built.length, reused, embedded, removed, failed: 0, stale: false }
  }
}
