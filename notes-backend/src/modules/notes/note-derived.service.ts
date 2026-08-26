import { Injectable, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { EmbeddingService } from '../semantic/embedding.service'
import { AiService } from '../ai/ai.service'
import { NoteCacheService } from './note-cache.service'
import { Note, NoteDocument } from './schemas/note.schema'
import { NoteVectorSourceService } from './note-vector-source.service'
import { NoteDerivedScheduler } from './note-derived-scheduler'
import { CategoriesService } from '../categories/categories.service'
import { TagsService } from '../tags/tags.service'
import { NoteChunkIndexService } from './note-chunk-index.service'

const TOPIC_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B'

export interface NoteDerivedChanges {
  titleChanged: boolean
  contentChanged: boolean
  taxonomyChanged: boolean
}

export interface NoteDerivedSnapshot {
  noteId: string
  userId: string
  title: string
  content: string
  summary: string
  categoryId?: string
  tagIds: string[]
  expectedUpdatedAt: Date
}

@Injectable()
export class NoteDerivedService {
  private readonly scheduler = new NoteDerivedScheduler()

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly embeddingService: EmbeddingService,
    private readonly aiService: AiService,
    private readonly noteCache: NoteCacheService,
    private readonly vectorSource: NoteVectorSourceService = new NoteVectorSourceService(),
    @Optional() private readonly categoriesService?: CategoriesService,
    @Optional() private readonly tagsService?: TagsService,
    @Optional() private readonly chunkIndex?: NoteChunkIndexService,
  ) {}

  buildFallbackSummary(content: string) {
    const cleanContent = String(content || '')
      .replace(/<[^>]+>/g, '')
      .replace(/[#*`_~>\[\]()]/g, '')
      .trim()
    return cleanContent.substring(0, 200) + (cleanContent.length > 200 ? '...' : '')
  }

  // 先清除旧派生字段并写入兜底摘要，确保读取方立即获得有效数据；AI 派生结果异步生成，不阻塞调用方。
  async refresh(note: NoteDocument): Promise<void> {
    const expectedTitle = String(note.title || '')
    const expectedContent = String(note.content || '')
    const fallbackSummary = this.buildFallbackSummary(expectedContent)
    ;(note as any).summary = fallbackSummary
    ;(note as any).embedding = undefined

    await this.noteModel.updateOne(
      { _id: note._id },
      { $set: { summary: fallbackSummary }, $unset: { embedding: 1 } },
      { timestamps: false },
    ).exec()

    this.updateEmbedding(note, expectedTitle, expectedContent)
    this.generateAndSaveSummary(note, expectedContent)
  }

  generateAndSaveSummary(note: NoteDocument, expectedContent = String(note.content || '')) {
    this.generateSummaryResult(expectedContent)
      .then(async ({ summary, source }) => {
        if (!summary) return
        // content 匹配条件确保在内容已被修改时不覆盖更新后的摘要。
        await this.noteModel.updateOne(
          { _id: note._id, content: expectedContent },
          { $set: { summary, summarySource: source, summaryUpdatedAt: new Date() } },
          { timestamps: false },
        ).exec()
        // AI 摘要异步写回后需再次失效列表缓存，否则前端列表最长 300 秒仍显示旧兜底摘要。
        await this.noteCache.invalidateLists()
      })
      .catch(err => console.error(`Failed to generate summary for note ${note._id}`, err))
  }

  async updateEmbedding(note: NoteDocument, expectedTitle = String(note.title || ''), expectedContent = String(note.content || '')) {
    try {
      const truncatedText = `${expectedTitle}\n${expectedContent}`.substring(0, 8000)
      const embedding = await this.embeddingService.generateEmbedding(truncatedText)
      if (embedding && embedding.length > 0) {
        // title + content 双重匹配，防止并发编辑时用旧 embedding 覆盖新内容。
        await this.noteModel.updateOne(
          { _id: note._id, title: expectedTitle, content: expectedContent },
          { $set: { embedding } },
          { timestamps: false },
        )
      }
    } catch (error) {
      console.error(`Failed to update embedding for note ${note._id}:`, error)
    }
  }

  schedule(note: NoteDocument, changes: NoteDerivedChanges): void {
    const noteId = String(note._id)
    const expectedUpdatedAt = new Date((note as any).updatedAt)
    const snapshot: NoteDerivedSnapshot = {
      noteId,
      userId: String(note.userId || ''),
      title: String(note.title || ''),
      content: String(note.content || ''),
      summary: String(note.summary || ''),
      categoryId: note.categoryId ? String(note.categoryId) : undefined,
      tagIds: (note.tags || []).map((tag) => String(tag)),
      expectedUpdatedAt,
    }

    this.scheduler.schedule(noteId, async () => {
      try {
        await this.refreshTopicArtifacts(snapshot, changes)
      } catch (error) {
        console.error(`Failed to refresh derived fields for note ${noteId}`, error)
      }
    })
  }

  async refreshTopicArtifacts(snapshot: NoteDerivedSnapshot, changes: NoteDerivedChanges): Promise<void> {
    let finalSummary = snapshot.summary
    if (changes.contentChanged) {
      const generated = await this.generateSummaryResult(snapshot.content)
      finalSummary = generated.summary || snapshot.summary
      const result = await this.noteModel.updateOne(
        { _id: snapshot.noteId, updatedAt: snapshot.expectedUpdatedAt },
        { $set: { summary: finalSummary, summarySource: generated.source, summaryUpdatedAt: new Date() } },
        { timestamps: false },
      ).exec()
      if (!result.matchedCount) return
      await this.noteCache.invalidateLists()
    }

    const [categoryName, tagNames] = await Promise.all([
      this.categoriesService?.findOwnedName(snapshot.categoryId, snapshot.userId),
      this.tagsService?.findOwnedNames(snapshot.tagIds, snapshot.userId) || Promise.resolve([]),
    ])
    const source = this.vectorSource.buildTopicVectorSource({
      title: snapshot.title,
      summary: finalSummary,
      categoryName,
      tagNames,
    })
    await this.updateTopicEmbedding(
      { _id: snapshot.noteId },
      source,
      snapshot.expectedUpdatedAt,
    )

    if (changes.titleChanged || changes.contentChanged) {
      await this.chunkIndex?.refreshNoteChunks({
        noteId: snapshot.noteId,
        userId: snapshot.userId,
        title: snapshot.title,
        content: snapshot.content,
        expectedUpdatedAt: snapshot.expectedUpdatedAt,
      })
    }
  }

  private async generateSummaryResult(content: string) {
    if (typeof (this.aiService as any).generateSummaryResult === 'function') {
      return (this.aiService as any).generateSummaryResult(content)
    }
    return { summary: await this.aiService.generateSummary(content), source: 'ai' as const }
  }

  async updateTopicEmbedding(note: { _id: any }, source: string, expectedUpdatedAt?: Date): Promise<void> {
    const embedding = await this.embeddingService.generateEmbedding(source)
    if (!embedding?.length) return

    await this.noteModel.updateOne(
      { _id: note._id, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
      {
        $set: {
          embedding,
          embeddingSourceHash: this.vectorSource.hashTopicVectorSource(source),
          embeddingModel: TOPIC_EMBEDDING_MODEL,
          embeddingUpdatedAt: new Date(),
        },
      },
      { timestamps: false },
    ).exec()
  }
}
