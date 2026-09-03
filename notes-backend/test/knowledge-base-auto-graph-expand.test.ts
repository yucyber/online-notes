import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'

const userId = '507f1f77bcf86cd799439012'
const noteId = '507f1f77bcf86cd799439014'
const chunkId = '507f1f77bcf86cd799439021'
// 7 个候选库 id（字符串升序）
const kbIds = ['507f1f77bcf86cd799439013', '507f1f77bcf86cd799439015', '507f1f77bcf86cd799439016', '507f1f77bcf86cd799439017', '507f1f77bcf86cd799439018', '507f1f77bcf86cd799439019', '507f1f77bcf86cd79943901a']

function execResult<T>(value: T) { return { exec: async () => value } }
function objectId(id: string) { return new Types.ObjectId(id) }
function evidence(chunkId: string) {
  return { chunkId, noteId, noteTitle: 'Note', headingPath: [], content: 'evidence ' + chunkId, graphPath: ['seed', 'neighbor'] }
}

// 构造服务并 stub 掉 expandGraphEvidence：本文件只测自动反查自身的逻辑
// （自有库发现/按 _id 上限/跨库去重/无候选早退），单库扩图内部的 ACL 由
// knowledge-graph-evidence-access.test.ts 覆盖，不在本文件重复。
function buildService(opts: { kbIds: Types.ObjectId[]; expand?: (kbId: string, chunkIds: string[]) => any[] }) {
  const expandCalls: Array<{ kbId: string; chunkIds: string[] }> = []
  let distinctFilter: any = null
  const linkModel = {
    distinct: (_field: string, filter: any) => {
      distinctFilter = filter
      return execResult(opts.kbIds)
    },
  }
  const service = new KnowledgeBasesService(
    {} as any,
    linkModel as any,
    {} as any,
    { objectId: (id: string) => new Types.ObjectId(id) } as any,
    {} as any,
    {} as any,
    undefined,
    {} as any,
  )
  ;(service as any).expandGraphEvidence = async (kbId: string, _uid: string, chunkIds: string[]) => {
    expandCalls.push({ kbId, chunkIds })
    return opts.expand ? opts.expand(kbId, chunkIds) : []
  }
  return { service, expandCalls, distinctFilter: () => distinctFilter }
}

test('expandGraphEvidenceAuto 经自有库链接反查候选库并逐库扩图', async () => {
  const { service, expandCalls, distinctFilter } = buildService({
    kbIds: [objectId(kbIds[0]), objectId(kbIds[1])],
    expand: (kbId) => [evidence(kbId === kbIds[0] ? 'chunk-a' : 'chunk-b')],
  })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  const filter = distinctFilter()
  assert.equal(String(filter.userId), userId, '候选库查询必须按当前 userId 过滤（他人/共享库不参与）')
  assert.deepEqual(filter.noteId.$in.map(String), [noteId], '只反查链接了种子笔记的库')
  assert.equal(result.attemptedKbs, 2)
  assert.deepEqual(expandCalls.map((call) => call.kbId), [kbIds[0], kbIds[1]])
  assert.deepEqual(expandCalls[0].chunkIds, [chunkId])
  assert.deepEqual(result.evidence.map((item: any) => item.chunkId).sort(), ['chunk-a', 'chunk-b'])
})

test('expandGraphEvidenceAuto 跨库证据按 chunkId 去重', async () => {
  const { service } = buildService({
    kbIds: [objectId(kbIds[0]), objectId(kbIds[1])],
    expand: () => [evidence('chunk-a')],
  })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  assert.equal(result.attemptedKbs, 2)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].chunkId, 'chunk-a')
})

test('expandGraphEvidenceAuto 候选库超过上限只扩前 5 个（按 _id 升序）', async () => {
  const sorted = kbIds.map(objectId).sort((left, right) => String(left).localeCompare(String(right)))
  const { service, expandCalls } = buildService({ kbIds: sorted })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  assert.equal(result.attemptedKbs, 5)
  assert.equal(expandCalls.length, 5)
  assert.deepEqual(expandCalls.map((call) => call.kbId), kbIds.slice(0, 5))
})

test('expandGraphEvidenceAuto 无自有库链接时返回空且 attemptedKbs 0', async () => {
  const { service, expandCalls } = buildService({ kbIds: [] })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  assert.equal(result.attemptedKbs, 0)
  assert.deepEqual(result.evidence, [])
  assert.equal(expandCalls.length, 0)
})

test('expandGraphEvidenceAuto 全部种子非法时早退且不查询模型', async () => {
  let modelCalled = false
  const linkModel = {
    distinct: () => { modelCalled = true; return execResult([]) },
  }
  const service = new KnowledgeBasesService(
    {} as any, linkModel as any, {} as any,
    { objectId: (id: string) => new Types.ObjectId(id) } as any,
    {} as any, {} as any, undefined, {} as any,
  )
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId: 'not-an-id', noteId: 'also-bad' }])
  assert.equal(result.attemptedKbs, 0)
  assert.equal(modelCalled, false)
})
