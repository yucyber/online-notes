import { Inject, Injectable, Optional } from '@nestjs/common'
import { createHash } from 'crypto'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'

type RedisClient = Pick<Redis, 'get' | 'set' | 'incr'>

@Injectable()
export class NoteCacheService {
  private readonly listTtlSeconds = 300
  private readonly listRevisionKey = 'notes:list:revision'

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly injectedRedis?: Redis) {}

  protected getClient(): RedisClient {
    if (!this.injectedRedis) {
      throw new Error('Redis client is not configured')
    }
    return this.injectedRedis
  }

  // payload 包含全部筛选条件，对它做 SHA1 可以区分任意筛选组合，同时把 key 长度限定在常量范围内。
  buildListKey(userId: string, payload: Record<string, unknown>, revision = '0'): string {
    const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex')
    return `notes:list:${revision}:${userId}:${hash}`
  }

  async getListRevision(): Promise<string> {
    try {
      return await this.getClient().get(this.listRevisionKey) || '0'
    } catch {
      return '0'
    }
  }

  async getList<T>(userId: string, payload: Record<string, unknown>, revision = '0'): Promise<T | null> {
    try {
      const cached = await this.getClient().get(this.buildListKey(userId, payload, revision))
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }

  async setList(userId: string, payload: Record<string, unknown>, value: unknown, revision = '0'): Promise<void> {
    try {
      await this.getClient().set(this.buildListKey(userId, payload, revision), JSON.stringify(value), 'EX', this.listTtlSeconds)
    } catch {
      // 缓存写入失败不能阻断笔记列表读取；降级为直接查库即可。
    }
  }

  async invalidateLists(): Promise<void> {
    try {
      // 全局 revision 同时覆盖 owner 与协作者视角；旧 key 继续按 TTL 自然过期。
      await this.getClient().incr(this.listRevisionKey)
    } catch {
      // Redis 不可用时不能阻断笔记写入，后续列表读取会自然降级到数据库。
    }
  }
}
