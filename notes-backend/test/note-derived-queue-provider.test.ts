import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ConfigService } from '@nestjs/config'
import { REDIS_CLIENT } from '../src/common/redis/redis.constants'
import { NOTE_DERIVED_QUEUE } from '../src/modules/notes/note-derived-job.types'
import { NoteDerivedQueueService } from '../src/modules/notes/note-derived-queue.service'
import { NOTE_DERIVED_QUEUE_CONNECTION, NotesModule } from '../src/modules/notes/notes.module'

test('NotesModule 导出供调度器和监控页共享的 Queue provider', () => {
  const providers = Reflect.getMetadata('providers', NotesModule) as any[]
  const queueProvider = providers.find((provider) => provider.provide === NOTE_DERIVED_QUEUE)
  const serviceProvider = providers.find((provider) => provider.provide === NoteDerivedQueueService)
  assert.ok(queueProvider)
  assert.deepEqual(queueProvider.inject, [NOTE_DERIVED_QUEUE_CONNECTION])
  assert.deepEqual(serviceProvider.inject, [NOTE_DERIVED_QUEUE, NOTE_DERIVED_QUEUE_CONNECTION, REDIS_CLIENT, ConfigService])
  assert.ok((Reflect.getMetadata('exports', NotesModule) as any[]).includes(NOTE_DERIVED_QUEUE))
})
