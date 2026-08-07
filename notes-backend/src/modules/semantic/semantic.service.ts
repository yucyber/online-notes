import { Injectable, Inject, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import Redis from 'ioredis'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { EmbeddingService } from './embedding.service'
import { TagsService } from '../tags/tags.service'
import { AiService } from '../ai/ai.service'

// Explicitly reference the type definition to ensure ts-node picks it up
/// <reference path="../../types/ml-kmeans.d.ts" />

export type SemanticItem = { id: string; title: string; preview: string; score: number; updatedAt: string }
export type SemanticPage = { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; data: SemanticItem[] }

export type SemanticSearchOpts = {
  mode?: 'keyword' | 'vector' | 'hybrid'
  page?: number
  limit?: number
  categoryId?: string
  tagIds?: string[]
  threshold?: number
  tagsMode?: 'any' | 'all'
  categoriesMode?: 'any' | 'all'
}

@Injectable()
export class SemanticService {
  private readonly logger = new Logger(SemanticService.name);

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly embeddingService: EmbeddingService,
    private readonly aiService: AiService,
    private readonly tagsService: TagsService,
    private readonly noteAccess: NoteAccessService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  async searchVector(query: string, userId: string, opts: SemanticSearchOpts = {}): Promise<SemanticPage> {
    const page = Math.max(1, Number(opts.page || 1))
    const limit = Math.max(1, Math.min(100, Number(opts.limit || 10)))
    const threshold = Number(opts.threshold ?? 0)
    const vector = await this.embeddingService.generateEmbedding(query);
    if (!vector || vector.length === 0) {
      return { page, limit, total: 0, totalPages: 1, hasNext: false, data: [] }
    }

    const accessAnd: any[] = [this.noteAccess.readableFilter(userId)]
    if (opts.categoryId) accessAnd.push({ categoryId: opts.categoryId })
    if (Array.isArray(opts.tagIds) && opts.tagIds.length > 0) {
      accessAnd.push(opts.tagsMode === 'any'
        ? { tags: { $in: opts.tagIds } }
        : { tags: { $all: opts.tagIds } })
    }

    // Atlas vectorSearch cannot reliably express the ACL/public $or filter on every
    // deployed index version, so retrieve a bounded candidate window and enforce the
    // complete readable scope in the following match stage.
    const candidateLimit = Math.min(1000, Math.max(100, page * limit * 10))
    const items = await this.noteModel.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: vector,
          numCandidates: Math.max(100, candidateLimit * 10),
          limit: candidateLimit,
        }
      },
      { $match: { $and: accessAnd } },
      {
        $project: {
          title: 1,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
          updatedAt: 1
        }
      }
    ]).exec()

    let mapped: SemanticItem[] = (items || []).map((n: any) => ({
      id: String(n._id || n.id || ''),
      title: String(n.title || ''),
      preview: String(n.content || '').slice(0, 220),
      score: Number(n.score || 0),
      updatedAt: String(n.updatedAt || ''),
    }))
    if (threshold > 0) mapped = mapped.filter((item) => item.score >= threshold)

    const total = mapped.length
    const start = (page - 1) * limit
    const data = mapped.slice(start, start + limit)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    return { page, limit, total, totalPages, hasNext: page < totalPages, data }
  }

  async search(q: string, userId: string, opts: SemanticSearchOpts = {}): Promise<SemanticPage> {
    const page = Math.max(1, Number(opts.page || 1))
    const limit = Math.max(1, Math.min(100, Number(opts.limit || 10)))
    const threshold = Number(opts.threshold ?? 0)

    const and: any[] = [this.noteAccess.readableFilter(userId)]
    if (opts.categoryId) and.push({ categoryId: opts.categoryId })
    if (Array.isArray(opts.tagIds) && opts.tagIds.length > 0) {
      if (opts.tagsMode === 'any') and.push({ tags: { $in: opts.tagIds } })
      else and.push({ tags: { $all: opts.tagIds } })
    }

    const isCJK = !!q && /[\u4e00-\u9fff]/.test(q)
    // CJK \u4e0d\u652f\u6301 MongoDB $text \u5168\u6587\u7d22\u5f15\uff0c\u6539\u7528\u6b63\u5219\u5206\u8bcd\u5339\u914d\u3002
    const useText = !!q && !isCJK && (opts.mode === 'keyword' || opts.mode === 'vector' || opts.mode === 'hybrid')
    let items: any[] = []
    let total = 0

    if (useText) {
      and.push({ $text: { $search: q } })
      const query = { $and: and }
      const docs = await this.noteModel
        .find(query, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('title content updatedAt')
        .lean()
        .exec()
      const cnt = await this.noteModel.countDocuments(query)
      items = docs
      total = cnt
    } else {
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      let tokenList: string[] = [];

      if (isCJK) {
        tokenList = q.split(/[\s,.!?;:，。！？；：的了是和与或在用有个]+/)
          .filter(t => t.trim().length >= 1);

        if (tokenList.length === 0) tokenList = [q];
      } else {
        const rawTokens = q ? (q.match(/[A-Za-z0-9]+/g) || []) : []
        tokenList = rawTokens
          .filter(t => (/^[A-Za-z]+$/.test(t) && t.length >= 2) || (/^\d+$/.test(t) && t.length >= 3))
          .slice(0, 8)
      }

      if (q && tokenList.length === 0) {
        items = []
        total = 0
      } else {
        if (q && tokenList.length > 0) {
          const ors: any[] = []
          for (const t of tokenList) {
            const patt = isCJK ? escapeRegex(t) : `\\b${escapeRegex(t)}\\b`
            ors.push({ title: { $regex: patt, $options: 'i' } })
            ors.push({ content: { $regex: patt, $options: 'i' } })
          }
          and.push({ $or: ors })
        }

        const regexQuery = { $and: and }
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

  async discoverTopics(userId: string) {
    const cacheKey = `topics:${userId}`;
    this.logger.log(`Discovering topics for user: ${userId}`);

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.log(`Cache hit for ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (e) {
      this.logger.warn('Redis get failed', e);
    }

    const notes = await this.noteModel.find({
      userId: new Types.ObjectId(userId),
      status: 'published',
      embedding: { $exists: true, $not: { $size: 0 } }
    }).select('_id title content embedding');

    this.logger.log(`Found ${notes.length} notes with embeddings for user ${userId}`);

    if (notes.length < 5) {
      this.logger.log('Not enough notes to cluster (min 5)');
      return [];
    }

    const validNotes = notes.filter(n => Array.isArray(n.embedding) && n.embedding.length > 0);
    if (validNotes.length < 5) return [];

    const data = validNotes.map(n => n.embedding);
    const k = Math.min(Math.floor(validNotes.length / 3), 8);

    let clusters: number[] = [];
    try {
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      const mlKmeans = await dynamicImport('ml-kmeans') as any;
      const { kmeans } = mlKmeans;
      const result = kmeans(data, k, { initialization: 'kmeans++' });
      clusters = result.clusters;
    } catch (error) {
      this.logger.error('K-Means clustering failed', error);
      return [];
    }

    const groups: Record<number, any[]> = {};
    clusters.forEach((clusterId, index) => {
      if (!groups[clusterId]) groups[clusterId] = [];
      groups[clusterId].push(validNotes[index]);
    });

    const clusterIds = Object.keys(groups).map(Number);

    const results = await Promise.all(clusterIds.map(async (clusterId) => {
      const groupNotes = groups[clusterId];
      const context = groupNotes.slice(0, 3).map(n => {
        return `Title: ${n.title}\nContent: ${n.content.substring(0, 200)}...`;
      }).join('\n---\n');

      let topicName = `Topic Group ${clusterId + 1}`;
      try {
        topicName = await this.callAiToNameTopic(context);
      } catch (e) {
        this.logger.warn(`Failed to name topic for cluster ${clusterId}: ${e.message}`);
      }

      return {
        name: topicName,
        count: groupNotes.length,
        noteIds: groupNotes.map(n => n._id.toString()),
        preview: groupNotes.slice(0, 3).map(n => n.title)
      };
    }));

    const finalResults = results.sort((a, b) => b.count - a.count);

    try {
      await this.redis.set(cacheKey, JSON.stringify(finalResults), 'EX', 3600);
    } catch (e) {
      this.logger.warn('Redis set failed', e);
    }

    return finalResults;
  }

  private async callAiToNameTopic(context: string): Promise<string> {
    return this.aiService.generateTopicName(context)
  }

  async convertToTag(userId: string, topicName: string, noteIds: string[]) {
    const tag = await this.tagsService.findOrCreate(topicName, userId);

    const objectIds = noteIds.map(id => new Types.ObjectId(id));

    const result = await this.noteModel.updateMany(
      {
        _id: { $in: objectIds },
        userId: new Types.ObjectId(userId)
      },
      {
        $addToSet: { tags: (tag as any)._id }
      }
    );

    if (result.modifiedCount > 0) {
      await this.tagsService.incrementNoteCount((tag as any)._id, result.modifiedCount);
    }

    return { tag, updated: result.modifiedCount };
  }
}
