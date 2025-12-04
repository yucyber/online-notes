import { INestApplication } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import { JwtService } from '@nestjs/jwt'
import { RateLimiterRedis } from 'rate-limiter-flexible'
import Redis from 'ioredis'

export class JwtWsAdapter extends WsAdapter {
  constructor(
    app: INestApplication,
    private readonly jwt: JwtService,
    private readonly msgLimiter: RateLimiterRedis,
    private readonly connLimiter: RateLimiterRedis,
    private readonly redis: Redis
  ) {
    super(app)
  }

  create(port: number, options: any = {}) {
    const server = super.create(port, {
      ...options,
      path: '/ws',
      verifyClient: async (info, done) => {
        const ip = (info.req.socket.remoteAddress || '').replace('::ffff:', '')
        try { await this.connLimiter.consume(ip) } catch { return done(false, 429, 'Too Many Requests') }
        try {
          const url = new URL('http://localhost' + info.req.url)
          const token = url.searchParams.get('access_token') || ''
          if (!token) return done(false, 401, 'Unauthorized')
          const payload = this.jwt.verify(token)
          ;(info.req as any).user = { id: payload.sub, roles: payload.roles }
          return done(true)
        } catch {
          return done(false, 401, 'Unauthorized')
        }
      }
    })
    server.on('connection', (socket, req) => {
      const user = (req as any).user
      socket.send(JSON.stringify({ code: 0, message: 'WS_AUTH_OK', data: { userId: user?.id }, traceId: crypto.randomUUID(), ts: Date.now() }))
      socket.on('message', async (raw: Buffer) => {
        const ts = Date.now()
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return socket.send(JSON.stringify({ code: 500, message: 'invalid_json', data: null, traceId: crypto.randomUUID(), ts })) }
        const idemKey = `ws:req:${user?.id}:${msg.requestId}`
        const nx = await this.redis.set(idemKey, '1', 'EX', 300, 'NX')
        if (nx === null) {
          return socket.send(JSON.stringify({ code: 0, message: 'duplicate', data: null, traceId: crypto.randomUUID(), ts, requestId: msg.requestId }))
        }
        try { await this.msgLimiter.consume(String(user?.id)) } catch {
          socket.send(JSON.stringify({ code: 429, message: 'rate_limit', data: { retryAfter: 30 }, traceId: crypto.randomUUID(), ts }))
          return socket.close(4429, 'Rate limit exceeded')
        }
        socket.send(JSON.stringify({ code: 0, message: 'ack', data: { ok: true }, traceId: crypto.randomUUID(), ts, requestId: msg.requestId }))
      })
    })
    return server
  }
}
