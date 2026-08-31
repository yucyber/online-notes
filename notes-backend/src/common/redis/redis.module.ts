import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { REDIS_CLIENT } from './redis.constants'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      // 默认地址用 127.0.0.1 而非 localhost：Node 解析 localhost 可能优先走 IPv6 ::1，
      // 而本机 Redis 通常只监听 IPv4 的 127.0.0.1，导致 ECONNREFUSED ::1:6379。
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379'),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleDestroy() {
    void this.redis.quit().catch(() => {})
  }
}
