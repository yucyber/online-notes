import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Align all HTTP endpoints under the /api prefix so that the Next.js frontend
  // can rely on a predictable baseURL (see src/lib/api.ts).
  app.setGlobalPrefix('api');
  
  // Enable CORS
  app.enableCors({
  origin: [
    'http://localhost:3000',
    'http://10.34.145.130:3000',
  ],
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
  const port = Number(process.env.PORT) || 3001
  const host = process.env.HOST || '0.0.0.0'
  await app.listen(port, host)
  console.log(`Application is running on: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
}
bootstrap();