import { Inject, Injectable, Optional } from '@nestjs/common'
import { createHash } from 'crypto'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'

type RedisClient = Pick<Redis, 'get' | 'set'>

@Injectable()
export class NoteCacheService {
  private readonly listTtlSeconds = 300

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly injectedRedis?: Redis) {}

  protected getClient(): RedisClient {
    if (!this.injectedRedis) {
      throw new Error('Redis client is not configured')
    }
    return this.injectedRedis
  }

  // payload 包含全部筛选条件，对它做 SHA1 可以区分任意筛选组合，同时把 key 长度限定在常量范围内。
  buildListKey(userId: string, payload: Record<string, unknown>): string {
    const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex')
    return `notes:list:${userId}:${hash}`
  }

  async getList<T>(userId: string, payload: Record<string, unknown>): Promise<T | null> {
    try {
      const cached = await this.getClient().get(this.buildListKey(userId, payload))
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }

  async setList(userId: string, payload: Record<string, unknown>, value: unknown): Promise<void> {
    try {
      await this.getClient().set(this.buildListKey(userId, payload), JSON.stringify(value), 'EX', this.listTtlSeconds)
    } catch {
      // 缓存写入失败不能阻断笔记列表读取；降级为直接查库即可。
    }
  }
}
