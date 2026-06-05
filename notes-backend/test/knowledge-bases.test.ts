import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'

const userId = '507f1f77bcf86cd799439012'
const kbId = '507f1f77bcf86cd799439013'
const noteId = '507f1f77bcf86cd799439014'

function execResult<T>(value: T) {
  return { exec: async () => value }
}

function doc(value: any) {
  return {
    ...value,
    toObject: () => value,
  }
}

test('KnowledgeBasesService creates and lists user-scoped knowledge bases', async () => {
  const createdPayloads: any[] = []
  const queries: any[] = []
  const kbModel = {
    create: async (payload: any) => {
      createdPayloads.push(payload)
      return doc({ _id: new Types.ObjectId(kbId), ...payload, createdAt: new Date('2026-06-05T00:00:00.000Z') })
    },
    find: (query: any) => {
      queries.push(query)
      return {
        sort: () => execResult([
          doc({ _id: new Types.ObjectId(kbId), name: 'AI 产品线', description: '', userId: new Types.ObjectId(userId) }),
        ]),
      }
    },
  }
  const noteAccess = {
    objectId: (id: string) => new Types.ObjectId(id),
  }
  const service = new KnowledgeBasesService(kbModel as any, {} as any, {} as any, noteAccess as any)

  const created = await service.create({ name: '  AI 产品线  ', description: '  ' }, userId)
  const list = await service.findAll(userId)

  assert.equal(created.id, kbId)
  assert.equal(created.name, 'AI 产品线')
  assert.equal(created.description, '')
  assert.equal(createdPayloads[0].userId.toString(), userId)
  assert.equal(createdPayloads[0].name, 'AI 产品线')
  assert.equal(queries[0].userId.toString(), userId)
  assert.equal(list[0].id, kbId)
})

test('KnowledgeBasesService adds only readable notes to a knowledge base boundary', async () => {
  const accessCalls: any[] = []
  const linkWrites: any[] = []
  const kbModel = {
    findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), name: 'AI', userId: query.userId })),
  }
  const linkModel = {
    findOneAndUpdate: (filter: any, update: any, options: any) => ({
      exec: async () => {
        linkWrites.push({ filter, update, options })
        return doc({
          _id: new Types.ObjectId('507f1f77bcf86cd799439015'),
          knowledgeBaseId: filter.knowledgeBaseId,
          noteId: filter.noteId,
          userId: filter.userId,
        })
      },
    }),
  }
  const noteModel = {
    findOne: (query: any) => {
      accessCalls.push(query)
      return {
        select: () => execResult(doc({
          _id: new Types.ObjectId(noteId),
          title: 'MiMo 接入',
          updatedAt: new Date('2026-06-05T00:00:00.000Z'),
        })),
      }
    },
  }
  const noteAccess = {
    objectId: (id: string) => new Types.ObjectId(id),
    readScope: (targetNoteId: string, targetUserId: string) => ({ noteId: targetNoteId, userId: targetUserId, readable: true }),
  }
  const service = new KnowledgeBasesService(kbModel as any, linkModel as any, noteModel as any, noteAccess as any)

  const result = await service.addNote(kbId, noteId, userId)

  assert.deepEqual(accessCalls[0], { noteId, userId, readable: true })
  assert.equal(linkWrites[0].filter.knowledgeBaseId.toString(), kbId)
  assert.equal(linkWrites[0].filter.noteId.toString(), noteId)
  assert.equal(linkWrites[0].filter.userId.toString(), userId)
  assert.equal(linkWrites[0].options.upsert, true)
  assert.equal(result.note.id, noteId)
  assert.equal(result.note.title, 'MiMo 接入')
})
