import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { NoteVectorBackfillRunner } from '../src/modules/notes/note-vector-backfill.runner'

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const runner = app.get(NoteVectorBackfillRunner)
    const report = await runner.run((message) => console.log(message))
    console.log(JSON.stringify(report, null, 2))
    if (report.failed > 0) process.exitCode = 1
  } finally {
    await app.close()
  }
}

bootstrap().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
