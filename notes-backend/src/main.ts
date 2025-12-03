import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { JwtWsAdapter } from './ws/jwt-ws.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Align all HTTP endpoints under the /api prefix so that the Next.js frontend
  // can rely on a predictable baseURL (see src/lib/api.ts).
  app.setGlobalPrefix('api');
  
  // Enable CORS
  app.enableCors({
    origin: (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map(x => x.trim()),
    credentials: true,
  })
  
  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  // const port = process.env.PORT || 3001;
  // await app.listen(port);
  // console.log(`Application is running on: http://localhost:${port}`);
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
