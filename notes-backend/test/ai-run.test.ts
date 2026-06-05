import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { AiRunService } from '../src/modules/ai/ai-run.service'
import { AiService } from '../src/modules/ai/ai.service'

function createAiRunModelMock() {
  const created: any[] = []
  const updates: any[] = []

  const model = {
    create: async (payload: any) => {
      created.push(payload)
      return {
        toObject: () => ({
          _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
          createdAt: new Date('2026-06-05T00:00:00.000Z'),
          updatedAt: new Date('2026-06-05T00:00:00.000Z'),
          ...payload,
        }),
      }
    },
    findOneAndUpdate: (filter: any, update: any, options: any) => ({
      exec: async () => {
        updates.push({ filter, update, options })
        const base = created.find((item) => item.runId === filter.runId) || {}
        return {
          toObject: () => ({
            _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
            createdAt: new Date('2026-06-05T00:00:00.000Z'),
            updatedAt: new Date('2026-06-05T00:00:01.000Z'),
            ...base,
            ...update.$set,
          }),
        }
      },
    }),
  }

  return { model, created, updates }
}

test('AiRunService records started, succeeded, and failed AI runs', async () => {
  const { model, created, updates } = createAiRunModelMock()
  const service = new AiRunService(model as any)
  const userId = '507f1f77bcf86cd799439012'

  const started = await service.start({
    runId: 'run-fixed',
    graphName: 'MindmapGenerationGraph',
    userId,
    provider: 'mimo',
    model: 'mimo-v2.5-pro',
  })

  assert.equal(started.runId, 'run-fixed')
  assert.equal(started.status, 'running')
  assert.equal(created[0].graphName, 'MindmapGenerationGraph')
  assert.equal(created[0].userId.toString(), userId)
  assert.equal(created[0].provider, 'mimo')
  assert.equal(created[0].model, 'mimo-v2.5-pro')

  const succeeded = await service.succeed('run-fixed')

  assert.equal(succeeded.status, 'succeeded')
  assert.equal(updates[0].filter.runId, 'run-fixed')
  assert.equal(updates[0].update.$set.status, 'succeeded')
  assert.ok(updates[0].update.$set.finishedAt instanceof Date)

  const failed = await service.fail('run-fixed', new Error('provider unavailable'))

  assert.equal(failed.status, 'failed')
  assert.equal(updates[1].update.$set.error, 'provider unavailable')
})

test('AiService wraps audited workflow calls without changing the public response', async () => {
  const startCalls: any[] = []
  const succeeded: string[] = []
  const failed: any[] = []
  const gateway = {
    describeChatRoute: (route: string) => {
      assert.equal(route, 'reasoning')
      return { provider: 'mimo', model: 'mimo-v2.5-pro' }
    },
    chat: async () => 'graph TD\nA-->B',
  }
  const runs = {
    start: async (payload: any) => {
      startCalls.push(payload)
      return { runId: 'run-1', status: 'running' }
    },
    succeed: async (runId: string) => succeeded.push(runId),
    fail: async (runId: string, error: unknown) => failed.push({ runId, error }),
  }
  const service = new AiService(gateway as any, {} as any, runs as any)

  const result = await service.generateMermaid(
    { content: '画一个流程图' },
    { userId: '507f1f77bcf86cd799439012' },
  )

  assert.equal(result.messages[0].content, 'graph TD\nA-->B')
  assert.equal(startCalls[0].graphName, 'MermaidGenerationGraph')
  assert.equal(startCalls[0].userId, '507f1f77bcf86cd799439012')
  assert.equal(startCalls[0].provider, 'mimo')
  assert.equal(startCalls[0].model, 'mimo-v2.5-pro')
  assert.deepEqual(succeeded, ['run-1'])
  assert.deepEqual(failed, [])
})
