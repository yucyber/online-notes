import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ConfigService } from '@nestjs/config'
import { QueueMonitorService } from '../src/modules/queue-monitor/queue-monitor.service'

function makeService(values: Record<string, string> = {}) {
  const mounts: Array<{ path: string; handlers: any[] }> = []
  const express = { use: (path: string, ...handlers: any[]) => mounts.push({ path, handlers }) }
  const config = new ConfigService(values)
  const queue = { name: 'note-derived', metaValues: { version: 'bullmq:test' } }
  const service = new QueueMonitorService(config, { httpAdapter: { getInstance: () => express } } as any, queue as any)
  return { service, mounts }
}

test('正确配置时挂载 Bull Board 到管理路径', () => {
  const { service, mounts } = makeService({
    NODE_ENV: 'production', BULL_BOARD_USERNAME: 'operator', BULL_BOARD_PASSWORD: 'secret',
  })
  service.onModuleInit()
  assert.equal(mounts.length, 1)
  assert.equal(mounts[0].path, '/admin/queues')
  assert.equal(mounts[0].handlers.length, 2)
})

test('非生产环境缺少凭据时不挂载 Bull Board', () => {
  const { service, mounts } = makeService({ NODE_ENV: 'test' })
  service.onModuleInit()
  assert.equal(mounts.length, 0)
})

test('生产环境缺少凭据时拒绝启动', () => {
  const { service } = makeService({ NODE_ENV: 'production' })
  assert.throws(() => service.onModuleInit(), /Bull Board credentials are required in production/)
})
