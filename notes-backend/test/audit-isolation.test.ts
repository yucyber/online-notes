import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { AuditService } from '../src/modules/audit/audit.service'

const uidA = new Types.ObjectId().toString()
const uidB = new Types.ObjectId().toString()
const editableNoteId = new Types.ObjectId().toString()
const hiddenNoteId = new Types.ObjectId().toString()

function makeDoc(over: Record<string, unknown>) {
  return {
    _id: new Types.ObjectId(),
    resourceType: 'note',
    createdAt: new Date(),
    requestId: 'req-1',
    ...over,
    toObject() { return { ...this } },
  }
}

function matchesResource(resourceId: string, condition: any) {
  if (condition?.$in) return condition.$in.map(String).includes(String(resourceId))
  return String(resourceId) === String(condition)
}

function makeAuditModel(records: any[]) {
  const match = (query: any) => records.filter((record) =>
    matchesResource(record.resourceId, query.resourceId)
    && (!query.eventType || record.eventType === query.eventType),
  )
  return {
    find: (query: any) => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            populate: () => ({ exec: async () => match(query) }),
          }),
        }),
      }),
    }),
    countDocuments: async (query: any) => match(query).length,
  }
}

function makeNoteModel() {
  return {
    find: (query: any) => ({
      select: () => ({
        lean: () => ({
          exec: async () => query.$or
            ? [{ _id: editableNoteId }]
            : [{ _id: editableNoteId, title: '可编辑笔记' }],
        }),
      }),
    }),
  }
}

function makeService(records: any[]) {
  return new AuditService(makeAuditModel(records) as any, makeNoteModel() as any)
}

test('AuditService.list returns all collaborator events on editable notes only', async () => {
  const records = [
    makeDoc({ actorId: uidA, eventType: 'invitation_created', resourceId: editableNoteId }),
    makeDoc({ actorId: uidB, eventType: 'comment_created', resourceId: editableNoteId }),
    makeDoc({ actorId: uidA, eventType: 'version_created', resourceId: hiddenNoteId }),
  ]

  const result = await makeService(records).list({ actorId: uidA, page: 1, size: 20 })

  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map((item: any) => item.actorId), [uidA, uidB])
  assert.ok(result.items.every((item: any) => item.noteTitle === '可编辑笔记'))
})

test('AuditService.list filters cannot expand the editable note scope', async () => {
  const records = [
    makeDoc({ actorId: uidA, eventType: 'comment_created', resourceId: editableNoteId }),
    makeDoc({ actorId: uidB, eventType: 'comment_created', resourceId: hiddenNoteId }),
  ]
  const service = makeService(records)

  const hidden = await service.list({ actorId: uidA, resourceId: hiddenNoteId, eventType: 'comment_created' })
  const editable = await service.list({ actorId: uidA, resourceId: editableNoteId, eventType: 'comment_created' })

  assert.equal(hidden.total, 0)
  assert.deepEqual(hidden.items, [])
  assert.equal(editable.total, 1)
})
