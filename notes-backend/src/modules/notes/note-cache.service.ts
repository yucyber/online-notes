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
      // Cache failures must not affect notes list reads.
    }
  }
}
