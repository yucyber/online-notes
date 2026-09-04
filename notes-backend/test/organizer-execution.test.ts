import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { OrganizerExecutionService } from '../src/modules/organizer/organizer-execution.service'

const userId = '507f1f77bcf86cd799439012'
const proposalId = '507f1f77bcf86cd799439101'
const noteOne = '507f1f77bcf86cd799439014'
const kbId = '507f1f77bcf86cd799439033'

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

const auditStub = {
  record: async () => ({ id: 'audit-1' }),
}

function makeService(overrides: Record<string, any> = {}) {
  const proposalModel = {
    findOne: () => chain(null),
    ...(overrides.proposalModel || {}),
  }
  const executionModel = {
    findOne: () => chain(null),
    create: async () => { throw new Error('not implemented') },
    find: () => ({ sort: () => chain([]) }),
    ...(overrides.executionModel || {}),
  }
  const sessionStub = {
    withTransaction: async (work: () => unknown) => work(),
    endSession: async () => undefined,
  }
  const dbStub = { startSession: async () => sessionStub }
  const noteModel = {
    db: dbStub,
    findOne: () => chain(null),
    findById: () => ({
      session: () => ({
        select: () => ({
          lean: () => ({
            exec: async () => null,
          }),
        }),
      }),
    }),
    create: async () => { throw new Error('not implemented') },
    updateOne: () => ({ session: () => ({ exec: async () => ({ modifiedCount: 1 }) }) }),
    countDocuments: () => ({ session: async () => 0 }),
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    ...(overrides.noteModel || {}),
  }
  // 测试默认走内存版事务；显式提供 db 的用例可以模拟不支持事务的连接。
  if (noteModel.db === undefined) noteModel.db = dbStub
  const noteVersionModel = {
    findOne: () => ({ sort: () => ({ session: () => ({ exec: async () => null }) }) }),
    create: async () => {},
    ...(overrides.noteVersionModel || {}),
  }
  const tagModel = {
    findOne: () => chain(null),
    create: async () => { throw new Error('not implemented') },
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    ...(overrides.tagModel || {}),
  }
  const categoryModel = {
    findOne: () => chain(null),
    ...(overrides.categoryModel || {}),
  }
  const kbModel = {
    findOne: () => chain(null),
    create: async () => { throw new Error('not implemented') },
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    ...(overrides.kbModel || {}),
  }
  const kbNoteModel = {
    exists: () => ({ session: async () => null }),
    create: async () => {},
    find: () => ({ session: () => ({ exec: async () => [] }) }),
    deleteOne: () => ({ session: () => ({ exec: async () => ({ deletedCount: 1 }) }) }),
    countDocuments: () => ({ session: async () => 0 }),
    ...(overrides.kbNoteModel || {}),
  }

  return new OrganizerExecutionService(
    executionModel as any,
    proposalModel as any,
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

function proposalWithAction(action: any) {
  return doc({
    _id: new Types.ObjectId(proposalId),
    userId: new Types.ObjectId(userId),
    status: 'pending',
    revision: 1,
    summary: 'test',
    actions: [{ actionId: 'a1', noteIds: [new Types.ObjectId(noteOne)], ...action }],
  })
}

function createdExec(value: any) {
  const row = { _id: new Types.ObjectId('507f1f77bcf86cd799439111'), createdAt: new Date(), updatedAt: new Date(), ...value }
  return doc(row)
}

test('execute rejects stale proposal without writing data', async () => {
  const proposal = proposalWithAction({ type: 'add_tag', tagId: new Types.ObjectId('507f1f77bcf86cd799439032') })
  proposal.status = 'stale'
  const service = makeService({
    proposalModel: { findOne: () => chain(proposal) },
  })
  await assert.rejects(
    () => service.execute(userId, proposalId, ['a1']),
    /stale/,
  )
})

test('execute creates knowledge base and persists execution journal', async () => {
  const proposal = proposalWithAction({ type: 'create_knowledge_base', knowledgeBaseName: 'AI 整理库' })
  let proposalSaved = false
  proposal.save = async function () { proposalSaved = true; return this }
  const createdKb = doc({ _id: new Types.ObjectId(kbId), userId: new Types.ObjectId(userId), name: 'AI 整理库' })
  let executionCreated: any = null
  const executionValue = {
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'executed',
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
  }
  const service = makeService({
    proposalModel: { findOne: () => chain(proposal) },
    kbModel: {
      findOne: () => chain(null),
      create: async (rows: any[]) => { return [createdKb] },
    },
    kbNoteModel: {
      exists: () => ({ session: async () => null }),
      create: async () => {},
      find: () => ({ session: () => ({ exec: async () => [] }) }),
      countDocuments: () => ({ session: async () => 0 }),
    },
    executionModel: {
      findOne: () => chain(null),
      create: async (rows: any[]) => {
        executionCreated = rows[0]
        return [createdExec(executionValue)]
      },
      find: () => ({ sort: () => chain([]) }),
    },
  })

  const result = await service.execute(userId, proposalId, ['a1'], 'req-1')
  assert.equal(executionCreated.idempotencyKey, 'req-1')
  assert.equal(executionCreated.actions.length, 1)
  assert.equal(executionCreated.actions[0].type, 'create_knowledge_base')
  assert.ok(proposalSaved)
  assert.equal(result.status, 'executed')
})

test('execute returns existing execution when idempotency key repeats', async () => {
  const proposal = proposalWithAction({ type: 'add_tag', tagId: new Types.ObjectId('507f1f77bcf86cd799439032') })
  const existing = createdExec({
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'executed',
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
    actions: [],
  })
  let created = false
  const service = makeService({
    proposalModel: { findOne: () => chain(proposal) },
    executionModel: {
      findOne: () => chain(existing),
      create: async () => { created = true; return [] },
    },
  })
  const result = await service.execute(userId, proposalId, ['a1'], 'req-repeat')
  assert.equal(result.id, String(existing._id))
  assert.equal(created, false)
})

test('undo restores a rewritten note when user did not edit it afterwards', async () => {
  const afterUpdated = new Date('2026-09-04T12:00:00.000Z')
  const execution = createdExec({
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'executed',
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
    actions: [{
      actionId: 'a1',
      type: 'rewrite_note',
      noteIds: [new Types.ObjectId(noteOne)],
      result: { noteId: noteOne, afterUpdatedAts: { [noteOne]: String(afterUpdated) } },
      inverse: {
        previous: {
          noteId: noteOne,
          title: '旧标题',
          content: '旧正文',
          tags: [],
          categoryId: null,
          archivedAt: null,
        },
      },
    }],
  })
  let executionSaved = false
  execution.save = async function () { executionSaved = true; return this }
  const currentNote = doc({
    _id: new Types.ObjectId(noteOne),
    title: '新标题',
    content: '新正文',
    tags: [],
    categoryId: null,
    archivedAt: null,
    updatedAt: afterUpdated,
    save: async function () { this.title = '旧标题'; this.content = '旧正文'; return this },
  })
  const service = makeService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: {
      db: undefined,
      findById: (id: any) => ({
        session: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => ({ _id: id, updatedAt: afterUpdated }),
            }),
          }),
        }),
      }),
      findOne: () => ({
        session: () => ({
          exec: async () => currentNote,
        }),
      }),
    },
  })

  const result = await service.undo(userId, String(execution._id), 'undo-req')
  assert.equal(result.ok, true)
  assert.equal(executionSaved, true)
  assert.equal(currentNote.title, '旧标题')
  assert.equal(currentNote.content, '旧正文')
})

test('undo returns conflicts when a changed note was edited after execution', async () => {
  const afterUpdated = new Date('2026-09-04T12:00:00.000Z')
  const execution = createdExec({
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'executed',
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
    actions: [{
      actionId: 'a1',
      type: 'rewrite_note',
      noteIds: [new Types.ObjectId(noteOne)],
      result: { noteId: noteOne, afterUpdatedAts: { [noteOne]: String(afterUpdated) } },
      inverse: {},
    }],
  })
  let executionSaved = false
  execution.save = async function () { executionSaved = true; return this }
  const service = makeService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: {
      findById: () => ({
        session: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => ({
                _id: new Types.ObjectId(noteOne),
                updatedAt: new Date('2026-09-05T00:00:00.000Z'),
              }),
            }),
          }),
        }),
      }),
    },
  })

  const result = await service.undo(userId, String(execution._id), 'undo-conflict')
  assert.equal(result.ok, false)
  assert.equal(result.conflicts.length, 1)
  assert.equal(executionSaved, false)
})

test('execute rejects action when note updatedAt no longer matches proposal expectation', async () => {
  const proposal = proposalWithAction({
    type: 'add_tag',
    tagId: new Types.ObjectId('507f1f77bcf86cd799439032'),
    expectedUpdatedAt: [{ noteId: new Types.ObjectId(noteOne), updatedAt: new Date('2026-09-01T00:00:00.000Z') }],
  })
  const service = makeService({
    proposalModel: { findOne: () => chain(proposal) },
    noteModel: {
      findById: () => ({
        session: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => ({ _id: new Types.ObjectId(noteOne), updatedAt: new Date('2026-09-05T00:00:00.000Z') }),
            }),
          }),
        }),
      }),
    },
  })

  await assert.rejects(
    () => service.execute(userId, proposalId, ['a1']),
    /updated after proposal/,
  )
})

test('execute fails loudly when MongoDB transaction is unavailable', async () => {
  const proposal = proposalWithAction({ type: 'add_tag', tagId: new Types.ObjectId('507f1f77bcf86cd799439032') })
  const service = makeService({
    proposalModel: { findOne: () => chain(proposal) },
    noteModel: { db: {} },
  })

  await assert.rejects(
    () => service.execute(userId, proposalId, ['a1']),
    /transaction support/,
  )
})

test('undo of an already undone execution is idempotent and returns ok', async () => {
  const execution = createdExec({
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'undone',
    undoneAt: new Date('2026-09-04T13:00:00.000Z'),
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
    actions: [],
  })
  let inverseCalled = false
  const service = makeService({
    executionModel: { findOne: () => chain(execution) },
    noteModel: {
      findById: () => ({
        session: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => ({ _id: new Types.ObjectId(noteOne), updatedAt: new Date('2026-09-04T12:00:00.000Z') }),
            }),
          }),
        }),
      }),
    },
  })
  service.applyInverse = async () => { inverseCalled = true }

  const result = await service.undo(userId, String(execution._id), 'undo-again')
  assert.equal(result.ok, true)
  assert.equal(result.execution.status, 'undone')
  assert.equal(inverseCalled, false)
})
test('execute merge creates new target and records source states for undo', async () => {
  const noteTwo = '507f1f77bcf86cd799439015'
  const targetCreated = '507f1f77bcf86cd799439020'
  const proposal = proposalWithAction({
    type: 'merge_notes',
    noteIds: [new Types.ObjectId(noteOne), new Types.ObjectId(noteTwo)],
    payload: { targetTitle: '合并目标', body: '合并正文' },
  })
  const sourceA = doc({
    _id: new Types.ObjectId(noteOne),
    title: '来源A',
    content: 'A内容',
    tags: [],
    categoryId: null,
    userId: new Types.ObjectId(userId),
    save: async function () { return this },
  })
  const sourceB = doc({
    _id: new Types.ObjectId(noteTwo),
    title: '来源B',
    content: 'B内容',
    tags: [],
    categoryId: null,
    userId: new Types.ObjectId(userId),
    save: async function () { return this },
  })
  const sources: Record<string, any> = { [noteOne]: sourceA, [noteTwo]: sourceB }
  const after = new Date('2026-09-04T12:00:00.000Z')
  let executionCreated: any = null
  const executionValue = {
    userId: new Types.ObjectId(userId),
    proposalId: new Types.ObjectId(proposalId),
    proposalRevision: 1,
    status: 'executed',
    undoDeadline: new Date('2026-10-04T00:00:00.000Z'),
  }
  const service = makeService({
    proposalModel: { findOne: () => chain(proposal) },
    executionModel: {
      findOne: () => chain(null),
      create: async (rows: any[]) => {
        executionCreated = rows[0]
        return [createdExec(executionValue)]
      },
      find: () => ({ sort: () => chain([]) }),
    },
    noteModel: {
      findOne: (query: any) => ({
        session: () => ({
          exec: async () => sources[String(query._id)],
        }),
      }),
      findById: (id: any) => ({
        session: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => ({ _id: id, updatedAt: after }),
            }),
          }),
        }),
      }),
      create: async (rows: any[]) => [doc({ _id: new Types.ObjectId(targetCreated), title: rows[0].title, content: rows[0].content, tags: [], categoryId: null, userId: new Types.ObjectId(userId) })],
    },
  })

  const result = await service.execute(userId, proposalId, ['a1'], 'req-merge')
  const journal = executionCreated.actions[0]
  assert.equal(journal.type, 'merge_notes')
  assert.equal(journal.result.createdTarget, true)
  assert.equal(journal.result.targetNoteId, targetCreated)
  assert.equal(journal.inverse.sourceStates.length, 2)
  assert.equal(journal.inverse.previousTarget, undefined)
  assert.equal(result.status, 'executed')
})

