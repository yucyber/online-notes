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
    provider: 'siliconflow',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
  })

  assert.equal(started.runId, 'run-fixed')
  assert.equal(started.status, 'running')
  assert.equal(created[0].graphName, 'MindmapGenerationGraph')
  assert.equal(created[0].userId.toString(), userId)
  assert.equal(created[0].provider, 'siliconflow')
  assert.equal(created[0].model, 'deepseek-ai/DeepSeek-V4-Flash')
  assert.deepEqual(created[0].stages, [])
  assert.deepEqual(created[0].metrics, {})

  await service.addStage('run-fixed', {
    name: 'provider',
    durationMs: -12.8,
    status: 'succeeded',
    attempt: 1.9,
    provider: 'siliconflow',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    prompt: 'must not be stored',
  } as any)
  await service.mergeMetrics('run-fixed', {
    inputChars: 12.9,
    candidateNotes: -3,
    candidateChunks: '4',
    outputChars: Number.NaN,
    content: 'must not be stored',
  } as any)

  assert.deepEqual(updates[0].update, {
    $push: {
      stages: {
        name: 'provider',
        durationMs: 0,
        status: 'succeeded',
        attempt: 1,
        provider: 'siliconflow',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
      },
    },
  })
  assert.deepEqual(updates[1].update, {
    $set: {
      'metrics.inputChars': 12,
      'metrics.candidateNotes': 0,
    },
  })

  const succeeded = await service.succeed('run-fixed')

  assert.equal(succeeded.status, 'succeeded')
  assert.equal(updates[2].filter.runId, 'run-fixed')
  assert.equal(updates[2].update.$set.status, 'succeeded')
  assert.ok(updates[2].update.$set.finishedAt instanceof Date)

  const failed = await service.fail('run-fixed', new Error('provider unavailable'))

  assert.equal(failed.status, 'failed')
  assert.equal(updates[3].update.$set.error, 'provider unavailable')
})

test('AiService passes workflow audit context without changing the public response', async () => {
  const calls: any[] = []
  const gateway = {
    chatTask: async (options: any) => {
      calls.push(options)
      return { content: 'graph TD\nA-->B', attempt: {} }
    },
  }
  const service = new AiService(gateway as any, {} as any)

  const result = await service.generateMermaid(
    { content: '画一个流程图' },
    { userId: '507f1f77bcf86cd799439012' },
  )

  assert.equal(result.content, 'graph TD\nA-->B')
  assert.equal(calls[0].task, 'mermaid')
  assert.deepEqual(calls[0].audit, {
    graphName: 'MermaidGenerationGraph',
    userId: '507f1f77bcf86cd799439012',
  })
})
