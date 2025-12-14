import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { EmbeddingService } from './embedding.service'

export type SemanticItem = { id: string; title: string; preview: string; score: number; updatedAt: string }
export type SemanticPage = { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; data: SemanticItem[] }

@Injectable()
export class SemanticService {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly embeddingService: EmbeddingService
  ) { }

  async searchVector(query: string, userId: string): Promise<any[]> {
    const vector = await this.embeddingService.generateEmbedding(query);
    if (!vector || vector.length === 0) {
      return [];
    }

    return this.noteModel.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: vector,
          numCandidates: 100,
          limit: 10,
          filter: {
            userId: { $eq: new Types.ObjectId(userId) }
          }
        }
      },
      {
        $project: {
          title: 1,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
          updatedAt: 1
        }
      }
    ]).exec();
  }

  async search(q: string, opts: { mode?: 'keyword' | 'vector' | 'hybrid'; page?: number; limit?: number; categoryId?: string; tagIds?: string[]; threshold?: number; tagsMode?: 'any' | 'all'; categoriesMode?: 'any' | 'all' }): Promise<SemanticPage> {
    const page = Math.max(1, Number(opts.page || 1))
    const limit = Math.max(1, Math.min(100, Number(opts.limit || 10)))
    const threshold = Number(opts.threshold ?? 0)

    const and: any[] = []
    if (opts.categoryId) and.push({ categoryId: opts.categoryId })
    if (Array.isArray(opts.tagIds) && opts.tagIds.length > 0) {
      if (opts.tagsMode === 'any') and.push({ tags: { $in: opts.tagIds } })
      else and.push({ tags: { $all: opts.tagIds } })
    }
    const query = and.length > 0 ? { $and: and } : {}

    const isCJK = !!q && /[\u4e00-\u9fff]/.test(q)
    const useText = !!q && !isCJK && (opts.mode === 'keyword' || opts.mode === 'vector' || opts.mode === 'hybrid')
    let items: any[] = []
    let total = 0
    if (useText) {
      const docs = await this.noteModel
        .find({ ...(query as any), $text: { $search: q } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('title content updatedAt')
        .lean()
        .exec()
      const cnt = await this.noteModel.countDocuments({ ...(query as any), $text: { $search: q } })
      items = docs
      total = cnt
    } else {
      // Regex fallback with ASCII tokens (e.g., FCP/JWT) to improve CJK queries
      // 修复：过滤纯数字的短 token（如单个数字“2”），并使用单词边界，避免出现对 "222" 的伪命中
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      let tokenList: string[] = [];

      if (isCJK) {
        // For CJK, use the whole query or split by spaces. 
        // Improved: Split by common Chinese particles/stopwords to extract keywords from sentences
        // e.g. "前端用的什么框架" -> ["前端", "什么框架"]
        // Split by: space, punctuation, and common particles (的,了,是,和,与,或,在,用,有,个)
        tokenList = q.split(/[\s,.!?;:，。！？；：的了是和与或在用有个]+/)
          .filter(t => t.trim().length >= 1); // Keep short words too, but filter empty

        // If splitting didn't produce much (e.g. short query), keep original too
        if (tokenList.length === 0) tokenList = [q];
      } else {
        const rawTokens = q ? (q.match(/[A-Za-z0-9]+/g) || []) : []
        const filtered = rawTokens
          // 仅保留：包含字母且长度≥2，或纯数字长度≥3（避免单字符/两位数字造成泛匹配）
          .filter(t => (/^[A-Za-z]+$/.test(t) && t.length >= 2) || (/^\d+$/.test(t) && t.length >= 3))
          // 限制 token 数量，避免过多 $or 导致扫描成本上升
          .slice(0, 8)
        tokenList = filtered;
      }

      // 当存在查询词但没有有效 token 时，直接返回空结果，避免退化为“全部笔记”
      if (q && tokenList.length === 0) {
        items = []
        total = 0
      } else {
        // const tokenList = filtered.length > 0 ? filtered : (q ? [q] : []) // Removed old logic
        const ors: any[] = []
        for (const t of tokenList) {
          // For CJK, do NOT use word boundaries \b because CJK characters are not word boundaries in regex usually
          const patt = isCJK ? escapeRegex(t) : `\\b${escapeRegex(t)}\\b`
          ors.push({ title: { $regex: patt, $options: 'i' } })
          ors.push({ content: { $regex: patt, $options: 'i' } })
        }
        const regexQuery = q && tokenList.length > 0 ? { ...(query as any), $or: ors } : query
        const [docs, cnt] = await Promise.all([
          this.noteModel
            .find(regexQuery)
            .sort({ updatedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select('title content updatedAt')
            .lean()
            .exec(),
          this.noteModel.countDocuments(regexQuery),
        ])
        items = docs
        total = cnt
      }
    }

    let mapped: SemanticItem[] = (items || []).map((n: any) => ({
      id: String(n._id || n.id || ''),
      title: String(n.title || ''),
      preview: String(n.content || '').slice(0, 220),
      score: Number((n as any).score || 0),
      updatedAt: String(n.updatedAt || ''),
    }))
    if (threshold > 0) mapped = mapped.filter((x) => Number(x.score || 0) >= threshold)
    const totalPages = Math.max(1, Math.ceil(Number(total || 0) / limit))
    const hasNext = page < totalPages
    return { page, limit, total, totalPages, hasNext, data: mapped }
  }
}
