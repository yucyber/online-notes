import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from './schemas/note.schema'
import { NoteFilterDto } from './dto'

@Injectable()
export class NoteRecommendationService {
  constructor(@InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>) {}

  // 推荐仅限当前用户自己的笔记，不使用 readableFilter；避免把他人共享的笔记推入关联结果。
  async getRecommendations(userId: string, currentNoteId?: string, limit = 5, context: NoteFilterDto = {}): Promise<Note[]> {
    const userObjectId = new Types.ObjectId(userId)
    const recommendations: Note[] = []
    const excludeIds: Types.ObjectId[] = []
    const andConditions: any[] = [{ userId: userObjectId }]
    const { keyword, categoryId, tagIds, startDate, endDate, status, tagsMode, searchMode } = context

    if (keyword) {
      andConditions.push(searchMode === 'text'
        ? { $text: { $search: keyword } }
        : { $or: [{ title: { $regex: keyword, $options: 'i' } }, { content: { $regex: keyword, $options: 'i' } }] })
    }
    if (categoryId) andConditions.push({ categoryId: new Types.ObjectId(categoryId) })
    if (tagIds && tagIds.length > 0) {
      const tags = Array.isArray(tagIds) ? tagIds : [tagIds]
      const objectIds = tags.filter(Boolean).map((id) => new Types.ObjectId(id))
      const stringIds = tags.filter(Boolean)
      const op = tagsMode === 'all' || (tags.length > 1 && !tagsMode) ? '$all' : '$in'
      andConditions.push({ $or: [{ tags: { [op]: objectIds } }, { tags: { [op]: stringIds } }] })
    }
    if (startDate || endDate) {
      const dateQuery: any = {}
      if (startDate) dateQuery.$gte = new Date(startDate)
      if (endDate) dateQuery.$lte = new Date(endDate)
      andConditions.push({ updatedAt: dateQuery })
    }
    andConditions.push({ status: status || 'published' })

    if (currentNoteId) {
      try {
        const currentNote = await this.noteModel.findById(currentNoteId).select('+embedding').exec()
        if (currentNote) {
          excludeIds.push(currentNote._id as Types.ObjectId)
          if (currentNote.embedding && currentNote.embedding.length > 0) {
            try {
              // 向量搜索作为第一级；向量不可用时降级为同标签笔记，最后兜底为最近更新。
              const vectorResults = await this.noteModel.aggregate([
                { $vectorSearch: { index: 'vector_index', path: 'embedding', queryVector: currentNote.embedding, numCandidates: 50, limit, filter: { userId: { $eq: userObjectId } } } },
                { $match: { _id: { $ne: currentNote._id }, status: 'published' } },
                { $project: { title: 1, content: 1, categoryId: 1, tags: 1, userId: 1, status: 1, createdAt: 1, updatedAt: 1, score: { $meta: 'vectorSearchScore' } } },
              ]).exec()
              recommendations.push(...(vectorResults as any[]))
              vectorResults.forEach((note) => excludeIds.push(note._id))
            } catch (error) { console.warn('[Recommendations] Vector search failed, falling back to tags', error) }
          }
          if (recommendations.length < limit && currentNote.tags?.length > 0) {
            const relatedNotes = await this.noteModel.find({ $and: andConditions, _id: { $nin: excludeIds }, tags: { $in: currentNote.tags } }).limit(limit - recommendations.length).select('title content categoryId tags userId status createdAt updatedAt').lean().exec()
            recommendations.push(...relatedNotes)
            relatedNotes.forEach((note) => excludeIds.push(note._id as Types.ObjectId))
          }
        }
      } catch (error) { console.error('Recommendations currentNote branch error', error) }
    }

    if (recommendations.length < limit) {
      const recentNotes = await this.noteModel.find({ $and: andConditions, _id: { $nin: excludeIds } }).sort({ createdAt: -1 }).limit(limit - recommendations.length).select('title content categoryId tags userId status createdAt updatedAt').lean().exec()
      recommendations.push(...recentNotes)
      recentNotes.forEach((note) => excludeIds.push(note._id as Types.ObjectId))
    }

    const remaining = Math.max(0, limit - recommendations.length)
    const drafts = remaining > 0
      ? await this.noteModel.find({ userId: userObjectId, status: 'draft', _id: { $nin: excludeIds } }).sort({ createdAt: -1 }).limit(Math.min(2, remaining)).select('title content categoryId tags userId status createdAt updatedAt').lean().exec()
      : []
    // 统一对外输出 id，不暴露 _id（lean 结果不走 toJSON）
    return [...recommendations, ...drafts].slice(0, Math.max(0, limit)).map((it: any) => {
      const { _id, ...rest } = it
      return { ...rest, id: String(_id) }
    })
  }
}
