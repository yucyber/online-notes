import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { AuditService } from '../src/modules/audit/audit.service'

const uidA = new Types.ObjectId().toString()
const uidB = new Types.ObjectId().toString()
const noteId = new Types.ObjectId().toString()

function makeDoc(over: Record<string, unknown>) {
  return {
    _id: new Types.ObjectId(),
    actorId: over.actorId,
    eventType: over.eventType,
    resourceId: over.resourceId,
    resourceType: 'note',
    createdAt: new Date(),
    requestId: 'req-1',
    toObject: () => over,
  }
}

function makeAuditModel(records: any[]) {
  const match = (query: any) => records.filter((r) =>
    r.actorId === query.actorId &&
    (!query.eventType || r.eventType === query.eventType) &&
    (!query.resourceId || r.resourceId === query.resourceId),
  )
  return {
    find: (query: any) => {
      // 断言调用方强制携带 actorId 过滤
      assert.ok(query.actorId, 'audit.find must filter by actorId')
      return {
        sort: () => ({ skip: () => ({ limit: () => ({ exec: async () => match(query) }) }) }),
      }
    },
    countDocuments: async (query: any) => match(query).length,
  }
}

function makeNoteModel() {
  return {
    find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }),
  }
}

function makeService(records: any[]) {
  return new AuditService(makeAuditModel(records) as any, makeNoteModel() as any)
}

test('AuditService.list only returns records belonging to the actor', async () => {
  const records = [
    makeDoc({ actorId: uidA, eventType: 'invitation_created', resourceId: noteId }),
    makeDoc({ actorId: uidB, eventType: 'comment_created', resourceId: noteId }),
    makeDoc({ actorId: uidA, eventType: 'version_created', resourceId: noteId }),
  ]
  const svc = makeService(records)

  const resA = await svc.list({ actorId: uidA, page: 1, size: 20 })
  const resB = await svc.list({ actorId: uidB, page: 1, size: 20 })

  // 用户 A 只能看到自己的 2 条
  assert.equal(resA.total, 2)
  assert.ok(resA.items.every((it: any) => it.actorId === uidA))
  // 用户 B 只能看到自己的 1 条
  assert.equal(resB.total, 1)
  assert.ok(resB.items.every((it: any) => it.actorId === uidB))
})

test('AuditService.list forces actorId scope regardless of other filters', async () => {
  const records = [
    makeDoc({ actorId: uidA, eventType: 'invitation_created', resourceId: noteId }),
    makeDoc({ actorId: uidB, eventType: 'comment_created', resourceId: noteId }),
  ]
  const svc = makeService(records)

  // 即使指定了 eventType/resourceId，也不能跨越 actorId 边界
  const res = await svc.list({ actorId: uidA, eventType: 'comment_created', page: 1, size: 20 })
  assert.equal(res.total, 0)
  assert.deepEqual(res.items, [])
})
