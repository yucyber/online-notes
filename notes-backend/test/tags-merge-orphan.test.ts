import { test } from 'node:test'
import assert = require('node:assert/strict')
import { TagsService } from '../src/modules/tags/tags.service'

const userId = '507f1f77bcf86cd799439012'
const srcId = '507f1f77bcf86cd799439101'
const targetId = '507f1f77bcf86cd799439102'

// 记录 updateMany 调用，便于断言匹配条件是否同时包含 ObjectId 与 String 两种形态。
function makeNoteModel() {
  const calls: any[] = []
  return {
    calls,
    updateMany: (filter: any, update: any) => {
      calls.push({ filter, update })
      // 模拟：只有命中（这里用 modifiedCount 区分 add 与 pull 两类调用）
      return { exec: async () => ({ modifiedCount: 1, matchedCount: 1 }) }
    },
  }
}

function makeTagModel() {
  const calls: any[] = []
  return {
    calls,
    deleteMany: (filter: any) => {
      calls.push({ kind: 'deleteMany', filter })
      return { exec: async () => ({ deletedCount: 1 }) }
    },
    findByIdAndUpdate: (id: any, update: any) => {
      calls.push({ kind: 'findByIdAndUpdate', id, update })
      return { exec: async () => ({}) }
    },
  }
}

function makeNoteCache() {
  const calls: any[] = []
  return {
    calls,
    invalidateLists: () => {
      calls.push({ kind: 'invalidateLists' })
      return Promise.resolve()
    },
  }
}

test('merge 同时匹配 ObjectId 与 String 形态的源标签', async () => {
  const noteModel = makeNoteModel()
  const tagModel = makeTagModel()
  const noteCache = makeNoteCache()
  const service = new TagsService(tagModel as any, noteModel as any, noteCache as any)

  await service.merge([srcId], targetId, userId)

  // 期望两次 updateMany（先 add 目标，再 pull 源），且匹配条件的 $in 数组同时含两种形态
  assert.equal(noteModel.calls.length, 2)

  const addCall = noteModel.calls[0]
  const pullCall = noteModel.calls[1]

  // add：$addToSet 目标 ObjectId
  assert.ok(addCall.update.$addToSet)
  // pull：$pull 的 $in 必须同时包含 ObjectId 与 String 两种源 id 形态
  const pullIn = pullCall.update.$pull.tags.$in
  const hasObjectId = pullIn.some((v: any) => v?.toHexString?.() === srcId)
  const hasString = pullIn.some((v: any) => v === srcId)
  assert.ok(hasObjectId, '$pull 的 $in 应包含 ObjectId 形态的源 id')
  assert.ok(hasString, '$pull 的 $in 应包含 String 形态的源 id')

  // 合并后必须使列表缓存失效
  assert.equal(noteCache.calls.length, 1)
  assert.equal(noteCache.calls[0].kind, 'invalidateLists')
})

test('merge 匹配条件同时含两种形态，避免字符串形态漏删', async () => {
  const noteModel = makeNoteModel()
  const tagModel = makeTagModel()
  const noteCache = makeNoteCache()
  const service = new TagsService(tagModel as any, noteModel as any, noteCache as any)

  await service.merge([srcId], targetId, userId)

  const addFilter = noteModel.calls[0].filter
  const inArr = addFilter.tags.$in
  const hasObjectId = inArr.some((v: any) => v?.toHexString?.() === srcId)
  const hasString = inArr.some((v: any) => v === srcId)
  assert.ok(hasObjectId)
  assert.ok(hasString)
})
