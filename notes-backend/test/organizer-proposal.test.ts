import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { OrganizerProposalService } from '../src/modules/organizer/organizer-proposal.service'

const userId = '507f1f77bcf86cd799439012'
const noteOne = '507f1f77bcf86cd799439014'
const noteTwo = '507f1f77bcf86cd799439015'
const outsideNote = '507f1f77bcf86cd799439016'
const chunkOne = '507f1f77bcf86cd799439021'
const chunkTwo = '507f1f77bcf86cd799439022'
const outsideChunk = '507f1f77bcf86cd799439023'
const categoryId = '507f1f77bcf86cd799439031'
const tagId = '507f1f77bcf86cd799439032'
const kbId = '507f1f77bcf86cd799439033'

function doc(value: any) {
  return {
    ...value,
    toObject: () => value,
    save: async function () { return this },
  }
}

function execResult(value: any) {
  return { exec: async () => value }
}

function noteAccessStub() {
  return {
    objectId: (id: string, label = 'id') => {
      if (!Types.ObjectId.isValid(id)) throw new Error(`${label} is invalid`)
      return new Types.ObjectId(id)
    },
    readableNotesQuery: (noteIds: Types.ObjectId[]) => ({ _id: { $in: noteIds } }),
  }
}

function makeService(overrides: Record<string, any> = {}) {
  const createdRows: any[] = []
  const proposalModel = {
    create: async (row: any) => {
      createdRows.push(row)
      return doc({ _id: new Types.ObjectId(), userId: row.userId, status: row.status, revision: row.revision, summary: row.summary, modelRunId: row.modelRunId, actions: row.actions, createdAt: new Date(), updatedAt: new Date() })
    },
    find: () => ({ sort: () => execResult([]) }),
    findOne: () => execResult(null),
    ...(overrides.proposalModel || {}),
  }
  const noteModel = {
    find: () => ({ select: () => execResult([]) }),
    ...(overrides.noteModel || {}),
  }
  const noteChunkModel = {
    find: () => ({ select: () => execResult([]) }),
    ...(overrides.noteChunkModel || {}),
  }
  const categoryModel = overrides.categoryModel || { find: () => ({ select: () => execResult([]) }) }
  const tagModel = overrides.tagModel || { find: () => ({ select: () => execResult([]) }) }
  const knowledgeBaseModel = overrides.knowledgeBaseModel || { find: () => ({ select: () => execResult([]) }) }

  const service = new OrganizerProposalService(
    proposalModel as any,
    noteAccessStub() as any,
    noteModel as any,
    noteChunkModel as any,
    tagModel as any,
    categoryModel as any,
    knowledgeBaseModel as any,
  ) as any
  service.__createdRows = createdRows
  return service
}

function readableNotes() {
  return {
    find: (query: any) => ({
      select: () => execResult([
        doc({ _id: new Types.ObjectId(noteOne), updatedAt: new Date('2026-09-01T00:00:00Z') }),
        doc({ _id: new Types.ObjectId(noteTwo), updatedAt: new Date('2026-09-02T00:00:00Z') }),
      ]),
    }),
  }
}

test('create persists only proposal rows and derives risk/evidence permissions', async () => {
  const service = makeService({
    noteModel: readableNotes(),
    noteChunkModel: {
      find: (query: any) => ({
        select: () => execResult([
          doc({ _id: new Types.ObjectId(chunkOne), noteId: new Types.ObjectId(noteOne) }),
          doc({ _id: new Types.ObjectId(chunkTwo), noteId: new Types.ObjectId(noteTwo) }),
          doc({ _id: new Types.ObjectId(outsideChunk), noteId: new Types.ObjectId(outsideNote) }),
        ]),
      }),
    },
    categoryModel: { find: () => ({ select: () => execResult([doc({ _id: new Types.ObjectId(categoryId) })]) }) },
    tagModel: { find: () => ({ select: () => execResult([doc({ _id: new Types.ObjectId(tagId) })]) }) },
    knowledgeBaseModel: { find: () => ({ select: () => execResult([doc({ _id: new Types.ObjectId(kbId) })]) }) },
  })

  const result = await service.create(userId, {
    summary: '整理建议',
    actions: [
      { type: 'add_tag', noteIds: [noteOne], tagId, tagName: '前端', reason: '归类', evidenceChunkIds: [chunkOne] },
      { type: 'set_category', noteIds: [noteTwo], categoryId, categoryName: '学习', reason: '归档' },
      { type: 'merge_notes', noteIds: [noteOne, noteTwo], reason: '内容重复', evidenceChunkIds: [chunkOne, chunkTwo, outsideChunk] },
      { type: 'create_knowledge_base', noteIds: [], knowledgeBaseName: '新库', reason: '新主题' },
      { type: 'rewrite_note', noteIds: [outsideNote], reason: '无权限' },
    ],
  })

  assert.equal(service.__createdRows.length, 1)
  const actions = result.actions
  assert.equal(actions.length, 4)
  assert.equal(actions[0].riskLevel, 'low')
  assert.equal(actions[1].riskLevel, 'low')
  assert.equal(actions[2].riskLevel, 'high')
  assert.equal(actions[3].type, 'create_knowledge_base')
  assert.deepEqual(actions[0].noteIds, [noteOne])
  assert.deepEqual(actions[2].evidenceChunkIds, [chunkOne, chunkTwo])
  assert.equal(actions[2].expectedUpdatedAt.length, 2)
  assert.equal(actions.some((action: any) => action.noteIds.includes(outsideNote)), false)
})

test('filters foreign taxonomy and evidence before persistence', async () => {
  const service = makeService({
    noteModel: readableNotes(),
    noteChunkModel: {
      find: (query: any) => ({
        select: () => execResult([
          doc({ _id: new Types.ObjectId(chunkOne), noteId: new Types.ObjectId(noteOne) }),
        ]),
      }),
    },
    categoryModel: { find: () => ({ select: () => execResult([]) }) },
    tagModel: { find: () => ({ select: () => execResult([]) }) },
    knowledgeBaseModel: { find: () => ({ select: () => execResult([]) }) },
  })

  await assert.rejects(
    () => service.create(userId, {
      actions: [
        { type: 'set_category', noteIds: [noteOne], categoryId, categoryName: 'foreign' },
        { type: 'add_tag', noteIds: [noteTwo], tagId, tagName: 'foreign' },
        { type: 'move_note', noteIds: [noteOne], knowledgeBaseId: kbId },
      ],
    }),
    /No readable proposal actions/,
  )
})

test('refreshStale marks proposal stale when note updatedAt changed', async () => {
  const savedValue = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    status: 'pending',
    revision: 1,
    summary: '',
    actions: [{
      actionId: 'a1',
      type: 'add_tag',
      noteIds: [new Types.ObjectId(noteOne)],
      evidenceChunkIds: [],
      expectedUpdatedAt: [{ noteId: new Types.ObjectId(noteOne), updatedAt: new Date('2026-09-01T00:00:00Z') }],
    }],
  }
  const savedDoc: any = { ...savedValue }
  savedDoc.toObject = () => savedDoc
  savedDoc.save = async function () { return this }
  const service = makeService({
    proposalModel: {
      findOne: () => execResult(savedDoc),
    },
    noteModel: {
      find: () => ({ select: () => execResult([
        doc({ _id: new Types.ObjectId(noteOne), updatedAt: new Date('2026-09-03T00:00:00Z') }),
      ]) }),
    },
  })

  const result = await service.refreshStale(String(savedDoc._id), userId)
  assert.equal(result.status, 'stale')
  assert.equal(savedDoc.status, 'stale')
})
