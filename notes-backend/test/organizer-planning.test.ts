import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { OrganizerPlanningService } from '../src/modules/organizer/organizer-planning.service'

const userId = '507f1f77bcf86cd799439012'
const noteIds = Array.from({ length: 6 }, (_, i) => `507f1f77bcf86cd79943902${i}`)
const tagId = '507f1f77bcf86cd799439050'
const kbId = '507f1f77bcf86cd799439051'

function noteDoc(index: number) {
  return {
    _id: new Types.ObjectId(noteIds[index]),
    title: `前端笔记 ${index}`,
    summary: '',
    categoryId: undefined,
    tags: [new Types.ObjectId(tagId)],
    updatedAt: new Date(),
  }
}

function noteAccessStub() {
  return {
    objectId: (id: string, label = 'id') => {
      if (!Types.ObjectId.isValid(id)) throw new Error(`${label} is invalid`)
      return new Types.ObjectId(id)
    },
    readableFilter: () => ({ _id: { $exists: true } }),
    readScope: (noteId: string) => ({ _id: new Types.ObjectId(noteId) }),
  }
}

function makePlanning(overrides: Record<string, any> = {}) {
  const proposalService = {
    create: async (_userId: string, draft: any) => ({ id: 'proposal-1', actions: draft.actions }),
    ...(overrides.proposalService || {}),
  }
  const noteModel = {
    find: () => ({ select: () => ({ limit: () => ({ lean: () => ({ exec: async () => [] }) }) }) }),
    findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => null }) }) }),
    ...(overrides.noteModel || {}),
  }
  const kbModel = overrides.kbModel || { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) }
  const kbNoteModel = overrides.kbNoteModel || { distinct: () => ({ exec: async () => [] }) }
  const categoryModel = overrides.categoryModel || { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) }
  const tagModel = overrides.tagModel || { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) }
  const config = overrides.config || { get: () => undefined }
  const service = new OrganizerPlanningService(
    proposalService as any,
    noteAccessStub() as any,
    noteModel as any,
    kbModel as any,
    kbNoteModel as any,
    categoryModel as any,
    tagModel as any,
    config as any,
  )
  return service
}

test('global proposal below threshold does not write proposal', async () => {
  const calls: any[] = []
  const service = makePlanning({
    proposalService: { create: async (...args: any[]) => { calls.push(args); return { id: 'proposal' } } },
    noteModel: {
      find: () => ({ select: () => ({ limit: () => ({ lean: () => ({ exec: async () => [noteDoc(0)] }) }) }) }),
    },
    config: { get: () => '5' },
  })

  const result = await service.createGlobalProposal(userId)
  assert.deepEqual(result, { generated: false, reason: 'below_threshold', threshold: 5, noteCount: 1 })
  assert.equal(calls.length, 0)
})

test('global proposal creates knowledge base actions for unlinked notes sharing a topic', async () => {
  let capturedDraft: any
  const service = makePlanning({
    proposalService: { create: async (_userId: string, draft: any) => { capturedDraft = draft; return { id: 'proposal-1', actions: draft.actions } } },
    noteModel: {
      find: () => ({ select: () => ({ limit: () => ({ lean: () => ({ exec: async () => Array.from({ length: 6 }, (_, i) => noteDoc(i)) }) }) }) }),
    },
    kbModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) },
    kbNoteModel: { distinct: () => ({ exec: async () => [] }) },
    categoryModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) },
    tagModel: {
      find: () => ({ select: () => ({ lean: () => ({ exec: async () => [{ _id: new Types.ObjectId(tagId), name: '前端' }] }) }) }),
    },
  })

  const result = await service.createGlobalProposal(userId)
  assert.equal(result.generated, true)
  assert.equal(capturedDraft.actions.length, 1)
  assert.equal(capturedDraft.actions[0].type, 'create_knowledge_base')
  assert.equal(capturedDraft.actions[0].knowledgeBaseName, '前端')
  assert.equal(capturedDraft.actions[0].noteIds.length, 6)
})

test('incremental proposal moves note into existing matching knowledge base', async () => {
  let capturedDraft: any
  const note = noteDoc(0)
  const service = makePlanning({
    proposalService: { create: async (_userId: string, draft: any) => { capturedDraft = draft; return { id: 'proposal-inc', actions: draft.actions } } },
    noteModel: {
      findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => note }) }) }),
    },
    kbModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [{ _id: new Types.ObjectId(kbId), name: '前端' }] }) }) }) },
    kbNoteModel: { distinct: () => ({ exec: async () => [] }) },
    categoryModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) },
    tagModel: {
      find: () => ({ select: () => ({ lean: () => ({ exec: async () => [{ _id: new Types.ObjectId(tagId), name: '前端' }] }) }) }),
    },
  })

  const result = await service.createIncrementalProposal(userId, noteIds[0])
  assert.equal(result.proposal.id, 'proposal-inc')
  assert.equal(capturedDraft.actions[0].type, 'move_note')
  assert.equal(capturedDraft.actions[0].knowledgeBaseId, kbId)
})

test('incremental proposal creates new knowledge base when no matching topic exists', async () => {
  let capturedDraft: any
  const service = makePlanning({
    proposalService: { create: async (_userId: string, draft: any) => { capturedDraft = draft; return { id: 'proposal-new' } } },
    noteModel: {
      findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ _id: new Types.ObjectId(noteIds[0]), title: '新主题', summary: '', tags: [], updatedAt: new Date() }) }) }) }),
    },
    kbModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) },
    categoryModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) },
    tagModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) }) },
  })

  await service.createIncrementalProposal(userId, noteIds[0])
  assert.equal(capturedDraft.actions[0].type, 'create_knowledge_base')
  assert.equal(capturedDraft.actions[0].knowledgeBaseName, '新主题')
})

test('incremental proposal skips when note already belongs to a knowledge base', async () => {
  let proposalCalls = 0
  const service = makePlanning({
    proposalService: { create: async () => { proposalCalls += 1; return { id: 'should-not-create' } } },
    noteModel: {
      findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => noteDoc(0) }) }) }),
    },
    kbNoteModel: {
      distinct: () => ({ exec: async () => [new Types.ObjectId(kbId)] }),
    },
  })

  const result = await service.createIncrementalProposal(userId, noteIds[0])
  assert.deepEqual(result, { generated: false, reason: 'already_organized', noteId: noteIds[0] })
  assert.equal(proposalCalls, 0)
})
