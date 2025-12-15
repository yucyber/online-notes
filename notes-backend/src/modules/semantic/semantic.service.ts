import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { EmbeddingService } from './embedding.service'
import { ConfigService } from '@nestjs/config'
import { TagsService } from '../tags/tags.service'
import Redis from 'ioredis'

// Explicitly reference the type definition to ensure ts-node picks it up
/// <reference path="../../types/ml-kmeans.d.ts" />

export type SemanticItem = { id: string; title: string; preview: string; score: number; updatedAt: string }
export type SemanticPage = { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; data: SemanticItem[] }

@Injectable()
export class SemanticService {
  private readonly logger = new Logger(SemanticService.name);
  private redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly embeddingService: EmbeddingService,
    private readonly configService: ConfigService,
    private readonly tagsService: TagsService
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

  async discoverTopics(userId: string) {
    const cacheKey = `topics:${userId}`;
    // Debug: Log userId
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

    // 1. Fetch Data
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

    // 2. Prepare Vectors & Filter invalid embeddings
    const validNotes = notes.filter(n => Array.isArray(n.embedding) && n.embedding.length > 0);
    if (validNotes.length < 5) return [];

    const data = validNotes.map(n => n.embedding);

    // 3. K-Means Clustering
    // K value: at least 3 notes per cluster, max 8 clusters
    const k = Math.min(Math.floor(validNotes.length / 3), 8);

    let clusters: number[] = [];
    try {
      // Dynamic import for ESM module (ml-kmeans is ESM only)
      // Use new Function to bypass TypeScript transpiling dynamic import to require()
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      const mlKmeans = await dynamicImport('ml-kmeans') as any;
      const { kmeans } = mlKmeans;
      const result = kmeans(data, k, { initialization: 'kmeans++' });
      clusters = result.clusters;
    } catch (error) {
      this.logger.error('K-Means clustering failed', error);
      return [];
    }

    // 4. Grouping
    const groups: Record<number, any[]> = {};
    clusters.forEach((clusterId, index) => {
      if (!groups[clusterId]) groups[clusterId] = [];
      groups[clusterId].push(validNotes[index]);
    });

    // 5. Naming
    // Limit concurrency to avoid rate limits
    const clusterIds = Object.keys(groups).map(Number);

    const results = await Promise.all(clusterIds.map(async (clusterId) => {
      const groupNotes = groups[clusterId];
      // Extract context from top 3 notes
      const context = groupNotes.slice(0, 3).map(n => {
        return `Title: ${n.title}\nContent: ${n.content.substring(0, 200)}...`;
      }).join('\n---\n');

      let topicName = `Topic Group ${clusterId + 1}`;
      try {
        // Timeout control handled in callCozeToNameTopic or here
        topicName = await this.callCozeToNameTopic(context);
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

    // Sort by count descending
    const finalResults = results.sort((a, b) => b.count - a.count);

    // Cache for 1 hour
    try {
      await this.redis.set(cacheKey, JSON.stringify(finalResults), 'EX', 3600);
    } catch (e) {
      this.logger.warn('Redis set failed', e);
    }

    return finalResults;
  }

  private async callCozeToNameTopic(context: string): Promise<string> {
    const apiKey = this.configService.get<string>('COZE_API_KEY');
    const botId = this.configService.get<string>('COZE_BOT_ID');

    if (!apiKey || !botId) {
      this.logger.warn('COZE_API_KEY or COZE_BOT_ID not configured');
      return 'Uncategorized Topic';
    }

    const prompt = `
You are a helpful assistant. 
Based on the following notes, summarize them into a single short topic phrase (2-6 words).
Examples: "Frontend Performance", "Travel Plans 2024", "React Hooks Learning".
Only return the phrase, no quotes or extra text.

Notes:
${context}
    `;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch('https://api.coze.cn/open_api/v2/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'Host': 'api.coze.cn',
          'Connection': 'keep-alive'
        },
        body: JSON.stringify({
          conversation_id: 'topic_discovery_' + Date.now(),
          bot_id: botId,
          user: 'system_topic_discovery',
          query: prompt,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Coze API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      // Parse Coze V2 response
      // Structure might vary, usually messages are in data.messages
      // Assuming non-streaming response
      if (data.messages && data.messages.length > 0) {
        const answer = data.messages.find((m: any) => m.type === 'answer');
        if (answer) {
          return answer.content.trim().replace(/^["']|["']$/g, '');
        }
      }

      return 'General Topic';
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Coze API timeout');
      }
      throw error;
    }
  }

  async convertToTag(userId: string, topicName: string, noteIds: string[]) {
    // 1. Find or Create Tag
    const tag = await this.tagsService.findOrCreate(topicName, userId);

    // 2. Update Notes
    const objectIds = noteIds.map(id => new Types.ObjectId(id));

    const result = await this.noteModel.updateMany(
      {
        _id: { $in: objectIds },
        userId: new Types.ObjectId(userId) // Security check
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
