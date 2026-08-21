import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, HttpException, HttpStatus } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import Redis from 'ioredis'
import { createHash } from 'crypto'
import { REDIS_CLIENT } from '../redis/redis.constants'

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const ctx = context.switchToHttp()
    const req = ctx.getRequest<any>()
    const res = ctx.getResponse<any>()

    const method = (req?.method || 'GET').toUpperCase()
    const keyHeader = (req?.headers?.['idempotency-key'] || req?.headers?.['Idempotency-Key']) as string | undefined

    // 仅在写操作且带幂等键时启用
    if (!keyHeader || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle()
    }

    if (!/^[A-Za-z0-9._-]{8,64}$/.test(String(keyHeader))) {
      throw new HttpException('Invalid Idempotency-Key', HttpStatus.BAD_REQUEST)
    }
    const endpoint = String(req?.route?.path || req?.originalUrl || req?.url || '')
    // 幂等键绑定用户维度的完整请求；ETag 条件头已废弃，不再纳入 hash
    const payloadHash = createHash('sha1').update(JSON.stringify({ body: req.body, params: req.params, query: req.query })).digest('hex')
    const userId = String((req?.user?.id || 'anon'))
    const baseKey = `idempotency:${userId}:${method}:${endpoint}:${keyHeader}`
    const cacheKey = `${baseKey}:result`
    const lockKey = `${baseKey}:lock`
    const existing = await this.redis.get(cacheKey)
    if (existing) {
      const parsed = JSON.parse(existing)
      if (parsed.payloadHash !== payloadHash) {
        throw new HttpException('idempotency payload mismatch', HttpStatus.CONFLICT)
      }
      res.setHeader('X-Idempotency-Applied', 'true')
      res.status(parsed.status || 200)
      return new Observable((observer) => { observer.next(parsed.envelope || parsed.response); observer.complete() })
    }
    const locked = await this.redis.setnx(lockKey, String(Date.now()))
    if (!locked) {
      const start = Date.now()
      while (Date.now() - start < 300) {
        const got = await this.redis.get(cacheKey)
        if (got) {
          const parsed = JSON.parse(got)
          if (parsed.payloadHash !== payloadHash) {
            throw new HttpException('idempotency payload mismatch', HttpStatus.CONFLICT)
          }
          res.setHeader('X-Idempotency-Applied', 'true')
          res.status(parsed.status || 200)
          return new Observable((observer) => { observer.next(parsed.envelope || parsed.response); observer.complete() })
        }
        await new Promise(r => setTimeout(r, 20))
      }
      throw new HttpException('idempotency in-flight', HttpStatus.CONFLICT)
    }
    await this.redis.expire(lockKey, 30)
    // 首次处理的请求在响应发送前标记头，避免在 tap（响应已发出）阶段再写 header 触发 ERR_HTTP_HEADERS_SENT。
    try { res.setHeader('X-Idempotency-Applied', 'false') } catch {}
    return next.handle().pipe(
      tap({
        next: async (response) => {
          try {
            const ttl = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 24 * 60 * 60)
            const status = res.statusCode || 200
            const envelope = (response && typeof response === 'object' && 'code' in response && 'timestamp' in response) ? response : { code: 0, message: 'OK', data: response, timestamp: Date.now() }
            await this.redis.set(cacheKey, JSON.stringify({ payloadHash, status, envelope, storedAt: Date.now() }), 'EX', ttl)
          } catch {
            // 缓存写入失败不应影响已完成的响应，也不应升级为未捕获 rejection 导致进程退出。
          } finally {
            try { await this.redis.del(lockKey) } catch {}
          }
        },
      }),
    )
  }
}
