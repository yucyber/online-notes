import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter'
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { JwtWsAdapter } from './ws/jwt-ws.adapter';
import { REDIS_CLIENT } from './common/redis/redis.constants';
import * as cookieParser from 'cookie-parser';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Align all HTTP endpoints under the /api prefix so that the Next.js frontend
  // can rely on a predictable baseURL (see src/lib/api.ts).
  app.setGlobalPrefix('api');

  // Enable CORS with regex pattern support for Vercel preview deployments
  const allowedOrigins = (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((x) => x.trim());

  const isProduction = process.env.NODE_ENV === 'production';

  // 生产环境不使用默认正则，必须显式配置 CORS_ALLOWED_PATTERNS
  const allowedPatterns = process.env.CORS_ALLOWED_PATTERNS
    ? process.env.CORS_ALLOWED_PATTERNS.split(',').map(p => new RegExp(p.trim()))
    : isProduction
      ? [] // 生产环境默认不匹配任何 preview 域名
      : [/^https:\/\/.*\.vercel\.app$/]; // 开发环境保留

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

  app.use(cookieParser());
  // 限制请求体大小，防止超大正文导致内存压力
  app.use(json({ limit: '2mb' }));

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  // Global response envelope & exception handling
  app.useGlobalFilters(new ApiExceptionFilter())

  const redis = app.get<Redis>(REDIS_CLIENT)
  const msgLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:msg:user', points: 300, duration: 60 })
  const connLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:conn:ip', points: 100, duration: 60 })
  app.useWebSocketAdapter(new JwtWsAdapter(app, app.get(JwtService), msgLimiter, connLimiter, redis))

  const port = Number(process.env.PORT) || 3001
  const host = process.env.HOST || '0.0.0.0'
  await app.listen(port, host)
  console.log(`Application is running on: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
}
bootstrap();
