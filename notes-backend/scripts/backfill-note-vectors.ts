import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { NoteVectorBackfillRunner } from '../src/modules/notes/note-vector-backfill.runner'

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const runner = app.get(NoteVectorBackfillRunner)
    if (process.argv.includes('--metadata-only')) {
      if (!process.argv.includes('--execute')) {
        console.log('DRY-RUN：未写入任何数据。仅补 Chunk 元数据需要用户明确确认后再加 --execute。')
        console.log(JSON.stringify(await runner.previewChunkMetadataMigration(), null, 2))
        return
      }
      console.log(JSON.stringify(await runner.migrateChunkMetadata(), null, 2))
      return
    }
    if (!process.argv.includes('--execute')) {
      const preview = await runner.preview()
      console.log('DRY-RUN：未写入任何数据。覆盖重建需要用户明确确认后再加 --execute。')
      console.log(JSON.stringify(preview, null, 2))
      return
    }
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
