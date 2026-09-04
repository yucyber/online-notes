import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { OrganizerExecutionService } from '../src/modules/organizer/organizer-execution.service'

const userId = '507f1f77bcf86cd799439012'
const proposalId = '507f1f77bcf86cd799439101'
const targetId = '507f1f77bcf86cd799439010'
const sourceOne = '507f1f77bcf86cd799439014'
const sourceTwo = '507f1f77bcf86cd799439015'
const createdOne = '507f1f77bcf86cd799439016'
const createdTwo = '507f1f77bcf86cd799439017'
const kbId = '507f1f77bcf86cd799439033'
const noteOne = '507f1f77bcf86cd799439014'

function doc(value: any) {
  return {
    ...value,
    toObject: () => value,
    save: async function () { return this },
  }
}

function execQ(value: any) {
  return { exec: async () => value }
}

function chain(value: any) {
  return {
    session: () => execQ(value),
    exec: async () => value,
  }
}

function noteAccessStub() {
  return {
    objectId: (id: string, label = 'id') => {
      if (!Types.ObjectId.isValid(id)) throw new Error(`${label} is invalid`)
      return new Types.ObjectId(id)
    },
    writeScope: (noteId: string) => ({ _id: new Types.ObjectId(noteId) }),
  }
}

const auditStub = { record: async () => ({ id: 'audit-1' }) }

function makeUndoService(overrides: Record<string, any> = {}) {
  const sessionStub = {
    withTransaction: async (work: () => unknown) => work(),
    endSession: async () => undefined,
  }
  const dbStub = { startSession: async () => sessionStub }
  const executionModel = {
    findOne: () => chain(null),
    ...(overrides.executionModel || {}),
  }
  const noteModel = {
    db: dbStub,
    findById: () => ({
      session: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }),
    }),
    findOne: () => chain(null),
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    updateOne: () => ({ session: () => ({ exec: async () => ({ modifiedCount: 1 }) }) }),
    countDocuments: () => ({ session: async () => 0 }),
    create: async () => [],
    ...(overrides.noteModel || {}),
  }
  if (noteModel.db === undefined) noteModel.db = dbStub
  const kbModel = {
    findOne: () => chain(null),
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    ...(overrides.kbModel || {}),
  }
  const kbNoteModel = {
    exists: () => ({ session: async () => null }),
    create: async () => {},
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    countDocuments: () => ({ session: async () => 0 }),
    ...(overrides.kbNoteModel || {}),
  }
  const tagModel = {
    findOne: () => chain(null),
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    updateOne: () => ({ session: () => ({ exec: async () => ({ modifiedCount: 1 }) }) }),
    countDocuments: () => ({ session: async () => 0 }),
  }
  const categoryModel = { findOne: () => chain(null) }
  const noteVersionModel = {
    findOne: () => ({ sort: () => ({ session: () => ({ exec: async () => null }) }) }),
    create: async () => {},
  }

  return new OrganizerExecutionService(
    executionModel as any,
    { findOne: () => chain(null) } as any,
    noteModel as any,
    noteVersionModel as any,
    tagModel as any,
    categoryModel as any,
    kbModel as any,
    kbNoteModel as any,
    noteAccessStub() as any,
    auditStub as any,
  ) as any
}

function executedDoc(actions: any[]) {
  return doc({
    _id: new Types.ObjectId('507f1f77bcf86cd799439111'),
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'executed',
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    actions,
  })
}

function updatedAtLookup(updatedAt: Date, ids: string[]) {
  return {
    findById: (id: any) => ({
      session: () => ({
        select: () => ({
          lean: () => ({
            exec: async () => ({ _id: id, updatedAt }),
          }),
        }),
      }),
    }),
  }
}

test('undo merge with existing target restores target snapshot and unarchives sources', async () => {
  const after = new Date('2026-09-04T12:00:00.000Z')
  const execution = executedDoc([{
    actionId: 'a1',
    type: 'merge_notes',
    noteIds: [new Types.ObjectId(sourceOne), new Types.ObjectId(sourceTwo)],
    result: {
      targetNoteId: targetId,
      createdTarget: false,
      afterUpdatedAts: { [sourceOne]: String(after), [sourceTwo]: String(after), [targetId]: String(after) },
    },
    inverse: {
      targetNoteId: targetId,
      createdTarget: false,
      sourceStates: [
        { noteId: sourceOne, title: '来源一', content: '来源一正文', tags: [], categoryId: null, archivedAt: null },
        { noteId: sourceTwo, title: '来源二', content: '来源二正文', tags: [], categoryId: null, archivedAt: null },
      ],
      previousTarget: { noteId: targetId, title: '旧目标标题', content: '旧目标正文', tags: [], categoryId: null, archivedAt: null },
    },
  }])
  let executionSaved = false
  execution.save = async function () { executionSaved = true; return this }

  const notes: Record<string, any> = {
    [sourceOne]: doc({ _id: new Types.ObjectId(sourceOne), title: '来源一', content: '来源一正文', tags: [], categoryId: null, archivedAt: new Date(after), updatedAt: after, save: async function () { return this } }),
    [sourceTwo]: doc({ _id: new Types.ObjectId(sourceTwo), title: '来源二', content: '来源二正文', tags: [], categoryId: null, archivedAt: new Date(after), updatedAt: after, save: async function () { return this } }),
    [targetId]: doc({ _id: new Types.ObjectId(targetId), title: '合并后标题', content: '合并后正文', tags: [], categoryId: null, archivedAt: null, updatedAt: after, save: async function () { return this } }),
  }
  const service = makeUndoService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: {
      ...updatedAtLookup(after, [sourceOne, sourceTwo, targetId]),
      findOne: (query: any) => ({
        session: () => ({
          exec: async () => notes[String(query._id)],
        }),
      }),
    },
  })

  const result = await service.undo(userId, String(execution._id), 'undo-merge')
  assert.equal(result.ok, true)
  assert.equal(notes[targetId].title, '旧目标标题')
  assert.equal(notes[targetId].content, '旧目标正文')
  assert.equal(notes[sourceOne].archivedAt, null)
  assert.equal(notes[sourceTwo].archivedAt, null)
  assert.equal(executionSaved, true)
})

test('undo split deletes created notes and restores archived source', async () => {
  const after = new Date('2026-09-04T12:00:00.000Z')
  const execution = executedDoc([{
    actionId: 'a2',
    type: 'split_note',
    noteIds: [new Types.ObjectId(noteOne)],
    result: {
      sourceNoteId: noteOne,
      createdNoteIds: [createdOne, createdTwo],
      afterUpdatedAts: { [noteOne]: String(after), [createdOne]: String(after), [createdTwo]: String(after) },
    },
    inverse: {
      sourceNoteId: noteOne,
      createdNoteIds: [createdOne, createdTwo],
      previous: { noteId: noteOne, title: '拆分前标题', content: '拆分前正文', tags: [], categoryId: null, archivedAt: null },
    },
  }])
  const source = doc({ _id: new Types.ObjectId(noteOne), title: '拆分后归档', content: '归档正文', tags: [], categoryId: null, archivedAt: new Date(after), updatedAt: after, save: async function () { return this } })
  const deletedIds: string[] = []
  const service = makeUndoService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: {
      ...updatedAtLookup(after, [noteOne, createdOne, createdTwo]),
      findOne: (query: any) => ({
        session: () => ({
          exec: async () => String(query._id) === noteOne ? source : null,
        }),
      }),
      deleteOne: (query: any) => {
        deletedIds.push(String(query._id))
        return { session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }
      },
    },
  })

  const result = await service.undo(userId, String(execution._id), 'undo-split')
  assert.equal(result.ok, true)
  assert.deepEqual(deletedIds.sort(), [createdOne, createdTwo].sort())
  assert.equal(source.title, '拆分前标题')
  assert.equal(source.archivedAt, null)
})

test('undo create knowledge base keeps kb when execution-external links exist', async () => {
  const after = new Date('2026-09-04T12:00:00.000Z')
  const execution = executedDoc([{
    actionId: 'a3',
    type: 'create_knowledge_base',
    noteIds: [new Types.ObjectId(noteOne)],
    result: { knowledgeBaseId: kbId, createdKb: true, addedNoteIds: [noteOne], afterUpdatedAts: { [noteOne]: String(after) } },
    inverse: { knowledgeBaseId: kbId, createdKb: true, noteIds: [noteOne] },
  }])
  let kbDeleted = false
  const deletedLinkQueries: string[] = []
  const service = makeUndoService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: { ...updatedAtLookup(after, [noteOne]) },
    kbModel: {
      deleteOne: () => ({ session: () => ({ exec: async () => { kbDeleted = true; return { deletedCount: 1 } } }) }),
    },
    kbNoteModel: {
      deleteOne: (query: any) => {
        deletedLinkQueries.push(String(query.noteId))
        return { session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }
      },
      countDocuments: () => ({ session: async () => 1 }),
    },
  })

  const result = await service.undo(userId, String(execution._id), 'undo-kb-external')
  assert.equal(result.ok, true)
  assert.deepEqual(deletedLinkQueries, [noteOne])
  assert.equal(kbDeleted, false)
})

test('undo create knowledge base deletes kb when it has no execution-external links', async () => {
  const after = new Date('2026-09-04T12:00:00.000Z')
  const execution = executedDoc([{
    actionId: 'a4',
    type: 'create_knowledge_base',
    noteIds: [new Types.ObjectId(noteOne)],
    result: { knowledgeBaseId: kbId, createdKb: true, addedNoteIds: [noteOne], afterUpdatedAts: { [noteOne]: String(after) } },
    inverse: { knowledgeBaseId: kbId, createdKb: true, noteIds: [noteOne] },
  }])
  let kbDeleted = false
  const service = makeUndoService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: { ...updatedAtLookup(after, [noteOne]) },
    kbModel: {
      deleteOne: () => ({ session: () => ({ exec: async () => { kbDeleted = true; return { deletedCount: 1 } } }) }),
    },
    kbNoteModel: {
      deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
      countDocuments: () => ({ session: async () => 0 }),
    },
  })

  const result = await service.undo(userId, String(execution._id), 'undo-kb-delete')
  assert.equal(result.ok, true)
  assert.equal(kbDeleted, true)
})

test('undo past undo deadline rejects', async () => {
  const execution = executedDoc([])
  execution.undoDeadline = new Date('2026-09-01T00:00:00.000Z')
  const service = makeUndoService({
    executionModel: { findOne: () => chain(execution) },
  })

  await assert.rejects(
    () => service.undo(userId, String(execution._id), 'undo-late'),
    /deadline has passed/,
  )
})
