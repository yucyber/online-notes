import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { EmbeddingService } from '../semantic/embedding.service'
import { AiService } from '../ai/ai.service'
import { NoteCacheService } from './note-cache.service'
import { Note, NoteDocument } from './schemas/note.schema'

@Injectable()
export class NoteDerivedService {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly embeddingService: EmbeddingService,
    private readonly aiService: AiService,
    private readonly noteCache: NoteCacheService,
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
    this.aiService.generateSummary(expectedContent)
      .then(async summary => {
        if (!summary) return
        // content 匹配条件确保在内容已被修改时不覆盖更新后的摘要。
        await this.noteModel.updateOne(
          { _id: note._id, content: expectedContent },
          { $set: { summary } },
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
}
