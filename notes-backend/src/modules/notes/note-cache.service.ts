import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import Redis from 'ioredis'

type RedisClient = Pick<Redis, 'get' | 'set'>

@Injectable()
export class NoteCacheService {
  private redis?: Redis
  private readonly listTtlSeconds = 300

  protected getClient(): RedisClient {
    if (!this.redis) {
      this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
    }
    return this.redis
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
