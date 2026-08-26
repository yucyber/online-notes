import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { CategoriesService } from '../categories/categories.service'
import { TagsService } from '../tags/tags.service'
import { NoteChunkerService } from './note-chunker.service'
import { NoteDerivedService } from './note-derived.service'
import { NoteVectorSourceService } from './note-vector-source.service'
import { NoteChunk, NoteChunkDocument } from './schemas/note-chunk.schema'
import { Note, NoteDocument } from './schemas/note.schema'

export interface NoteVectorBackfillReport {
  total: number
  topicSucceeded: number
  chunkSucceeded: number
  chunksCreated: number
  skipped: number
  failed: number
  summaryFallback: number
  failedNoteIds: string[]
  notes: Array<{ noteId: string; title: string; summarySource: string; chunks: number; status: 'rebuilt' | 'skipped' | 'failed' }>
}

@Injectable()
export class NoteVectorBackfillRunner {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(NoteChunk.name) private readonly chunkModel: Model<NoteChunkDocument>,
    private readonly derived: NoteDerivedService,
    private readonly chunker: NoteChunkerService,
    private readonly vectorSource: NoteVectorSourceService,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
  ) {}

  async run(onProgress?: (message: string) => void): Promise<NoteVectorBackfillReport> {
    const notes: any[] = await this.noteModel.find({}).lean().exec()
    const report: NoteVectorBackfillReport = {
      total: notes.length,
      topicSucceeded: 0,
      chunkSucceeded: 0,
      chunksCreated: 0,
      skipped: 0,
      failed: 0,
      summaryFallback: 0,
      failedNoteIds: [],
      notes: [],
    }

    for (let index = 0; index < notes.length; index++) {
      const note = notes[index]
      const noteId = String(note._id)
      const title = String(note.title || '')
      onProgress?.(`[${index + 1}/${notes.length}] ${title || noteId}`)
      try {
        const expectedChunks = this.chunker.buildChunks({ title, content: String(note.content || '') })
        const existingChunks: any[] = await this.chunkModel.find({ noteId }).lean().exec()
        if (await this.isUpToDate(note, expectedChunks, existingChunks)) {
          report.skipped++
          if (note.summarySource === 'fallback') report.summaryFallback++
          report.notes.push({ noteId, title, summarySource: String(note.summarySource), chunks: existingChunks.length, status: 'skipped' })
          continue
        }

        await this.derived.refreshTopicArtifacts({
          noteId,
          userId: String(note.userId),
          title,
          content: String(note.content || ''),
          summary: String(note.summary || ''),
          categoryId: note.categoryId ? String(note.categoryId) : undefined,
          tagIds: (note.tags || []).map(String),
          expectedUpdatedAt: new Date(note.updatedAt),
        }, { titleChanged: true, contentChanged: true, taxonomyChanged: true })

        const fresh: any = await this.noteModel.findById(noteId).lean().exec()
        const chunkCount = await this.chunkModel.countDocuments({ noteId })
        const topicOk = Boolean(fresh?.embeddingSourceHash)
        const chunksOk = chunkCount === expectedChunks.length
        if (topicOk) report.topicSucceeded++
        if (chunksOk) report.chunkSucceeded++
        if (fresh?.summarySource === 'fallback') report.summaryFallback++
        report.chunksCreated += Math.max(0, chunkCount - existingChunks.length)
        const status = topicOk && chunksOk ? 'rebuilt' : 'failed'
        if (status === 'failed') {
          report.failed++
          report.failedNoteIds.push(noteId)
        }
        report.notes.push({
          noteId,
          title,
          summarySource: String(fresh?.summarySource || 'fallback'),
          chunks: chunkCount,
          status,
        })
      } catch (error: any) {
        report.failed++
        report.failedNoteIds.push(noteId)
        report.notes.push({ noteId, title, summarySource: String(note.summarySource || 'fallback'), chunks: 0, status: 'failed' })
        onProgress?.(`失败 ${noteId}: ${error.message}`)
      }
    }
    return report
  }

  private async isUpToDate(note: any, expectedChunks: Array<{ chunkIndex: number; contentHash: string }>, existingChunks: any[]) {
    const summaryComplete = ['ai', 'passthrough'].includes(String(note.summarySource || ''))
      || (note.summarySource === 'fallback' && note.summaryUpdatedAt)
    if (!summaryComplete || !note.embeddingSourceHash) return false
    const [categoryName, tagNames] = await Promise.all([
      this.categories.findOwnedName(note.categoryId ? String(note.categoryId) : undefined, String(note.userId)),
      this.tags.findOwnedNames((note.tags || []).map(String), String(note.userId)),
    ])
    const source = this.vectorSource.buildTopicVectorSource({ title: note.title, summary: note.summary, categoryName, tagNames })
    if (this.vectorSource.hashTopicVectorSource(source) !== String(note.embeddingSourceHash)) return false
    if (expectedChunks.length !== existingChunks.length) return false
    const byIndex = new Map(existingChunks.map((chunk) => [Number(chunk.chunkIndex), chunk]))
    return expectedChunks.every((chunk) => {
      const current = byIndex.get(chunk.chunkIndex)
      return current?.contentHash === chunk.contentHash && Array.isArray(current.embedding) && current.embedding.length > 0
    })
  }
}
