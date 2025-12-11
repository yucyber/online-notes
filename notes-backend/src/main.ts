import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor'
import { ApiExceptionFilter } from './common/filters/api-exception.filter'
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor'
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { JwtWsAdapter } from './ws/jwt-ws.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Align all HTTP endpoints under the /api prefix so that the Next.js frontend
  // can rely on a predictable baseURL (see src/lib/api.ts).
  app.setGlobalPrefix('api');

  // Enable CORS with regex pattern support for Vercel preview deployments
  const allowedOrigins = (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((x) => x.trim());

  // Support regex patterns for dynamic Vercel preview URLs
  const allowedPatterns = process.env.CORS_ALLOWED_PATTERNS
    ? process.env.CORS_ALLOWED_PATTERNS.split(',').map(p => new RegExp(p.trim()))
    : [/^https:\/\/.*\.vercel\.app$/];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // Check if origin is in the allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Check if origin matches any pattern
      if (allowedPatterns.some(pattern => pattern.test(origin))) {
        return callback(null, true);
      }

      // Reject the request
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Request-ID', 'Idempotency-Key', 'If-Match', 'If-None-Match', 'X-Search-ID', 'x-search-id', 'X-Skip-Auth-Redirect', 'x-skip-auth-redirect'],
    exposedHeaders: ['X-Request-Id', 'ETag', 'X-Idempotency-Applied', 'X-Trace-Id'],
  })

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  // Global response envelope & exception handling
  // 顺序：先幂等拦截器（缓存最终包），再统一响应包拦截器
  app.useGlobalInterceptors(new IdempotencyInterceptor())
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor())
  app.useGlobalFilters(new ApiExceptionFilter())

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  const msgLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:msg:user', points: 300, duration: 60 })
  const connLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:conn:ip', points: 100, duration: 60 })
  app.useWebSocketAdapter(new JwtWsAdapter(app, app.get(JwtService), msgLimiter, connLimiter, redis))

  const port = Number(process.env.PORT) || 3001
  const host = process.env.HOST || '0.0.0.0'
  await app.listen(port, host)
  console.log(`Application is running on: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
}
bootstrap();
