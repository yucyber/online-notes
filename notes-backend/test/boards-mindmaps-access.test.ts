import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { BoardsService } from '../src/modules/boards/boards.service'
import { MindmapsService } from '../src/modules/mindmaps/mindmaps.service'
import { NoteAccessService } from '../src/modules/notes/note-access.service'

const noteAccess = new NoteAccessService()

function createModel(seed: any[] = []) {
  const rows = [...seed]
  return {
    async create(data: any) {
      const doc = { _id: data._id || new Types.ObjectId(), ...data }
      ;(doc as any).id = String(doc._id)
      rows.push(doc)
      return doc
    },
    findOne(query: any) {
      return {
        lean: () => ({
          exec: async () => rows.find(row =>
            String(row._id) === String(query._id) &&
            (query.userId === undefined || String(row.userId) === String(query.userId))
          ) || null,
        }),
      }
    },
    findOneAndUpdate(query: any, update: any) {
      return {
        lean: () => ({
          exec: async () => {
            const row = rows.find(item =>
              String(item._id) === String(query._id) &&
              String(item.userId) === String(query.userId)
            )
            if (!row) return null
            Object.assign(row, update)
            return row
          },
        }),
      }
    },
  }
}

// Note model mock - shape contract test for $or query.
// If the query shape changes, this mock must be updated.
function createNoteModel(seed: any[] = []) {
  const rows = [...seed]
  return {
    findOne(query: any) {
      return {
        select: () => ({
          lean: () => ({
            exec: async () => rows.find(row => {
              if (String(row._id) !== String(query._id)) return false
              const orClauses: any[] = query.$or || []
              return orClauses.some(clause => {
                if (clause.userId) return String(row.userId) === String(clause.userId)
                if (clause.acl?.$elemMatch?.userId) {
                  const target = String(clause.acl.$elemMatch.userId)
                  return Array.isArray(row.acl) && row.acl.some((entry: any) =>
                    String(entry.userId) === target &&
                    (!clause.acl.$elemMatch.role || entry.role === clause.acl.$elemMatch.role)
                  )
                }
                if (clause.visibility) return row.visibility === clause.visibility
                return false
              })
            }) || null,
          }),
        }),
      }
    },
  }
}

test('boards service denies cross-user read', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, title: 'A', content: {} }]) as any,
    createNoteModel() as any,
    noteAccess,
  )

  await assert.rejects(() => service.getById(String(boardId), String(otherId)), /Board not found/)
})

test('boards service allows owner read', async () => {
  const ownerId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, title: 'A', content: {} }]) as any,
    createNoteModel() as any,
    noteAccess,
  )

  const board = await service.getById(String(boardId), String(ownerId))
  assert.equal(board.id, String(boardId))
})

test('boards service allows read through source note acl', async () => {
  const ownerId = new Types.ObjectId()
  const collaboratorId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const noteId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, noteId, title: 'A', content: {} }]) as any,
    createNoteModel([{
      _id: noteId,
      userId: ownerId,
      acl: [{ userId: collaboratorId, role: 'viewer' }],
      visibility: 'private',
    }]) as any,
    noteAccess,
  )

  const board = await service.getById(String(boardId), String(collaboratorId))
  assert.equal(board.id, String(boardId))
})

test('boards service denies update from non-owner even if note acl reader', async () => {
  const ownerId = new Types.ObjectId()
  const collaboratorId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const noteId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, noteId, title: 'A', content: {} }]) as any,
    createNoteModel([{
      _id: noteId,
      userId: ownerId,
      acl: [{ userId: collaboratorId, role: 'viewer' }],
      visibility: 'private',
    }]) as any,
    noteAccess,
  )

  await assert.rejects(
    () => service.update(String(boardId), String(collaboratorId), { content: { nodes: [] } }),
    /Board not found/,
  )
})

test('boards service rejects invalid id with 400', async () => {
  const service = new BoardsService(createModel() as any, createNoteModel() as any, noteAccess)
  await assert.rejects(
    () => service.getById('not-a-valid-id', String(new Types.ObjectId())),
    /Board id is invalid/,
  )
})

test('boards service returns conflict on duplicate client supplied id', async () => {
  const ownerId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const model = createModel()
  model.create = async () => {
    const error: any = new Error('duplicate key')
    error.code = 11000
    throw error
  }
  const service = new BoardsService(model as any, createNoteModel() as any, noteAccess)

  await assert.rejects(
    () => service.create({ _id: String(boardId), userId: String(ownerId), title: 'A' }),
    /Board already exists/,
  )
})

test('mindmaps service denies cross-user update', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, title: 'M', content: {} }]) as any,
    createNoteModel() as any,
    noteAccess,
  )

  await assert.rejects(
    () => service.update(String(mapId), String(otherId), { content: { nodes: [] } }),
    /Mindmap not found/,
  )
})

test('mindmaps service allows owner update', async () => {
  const ownerId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, title: 'M', content: {} }]) as any,
    createNoteModel() as any,
    noteAccess,
  )

  const result = await service.update(String(mapId), String(ownerId), { content: { nodes: [{ id: 'a' }] } })
  assert.deepEqual(result.content, { nodes: [{ id: 'a' }] })
})

test('mindmaps service requires a source note', async () => {
  const service = new MindmapsService(createModel() as any, createNoteModel() as any, noteAccess)

  await assert.rejects(
    () => service.create({ userId: String(new Types.ObjectId()), title: 'M' } as any),
    /Note id is required/,
  )
})

test('mindmaps service rejects creation without note write access', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const noteId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel() as any,
    createNoteModel([{ _id: noteId, userId: ownerId, acl: [], visibility: 'private' }]) as any,
    noteAccess,
  )

  await assert.rejects(
    () => service.create({ userId: String(otherId), noteId: String(noteId), title: 'M' }),
    /Note not found/,
  )
})

test('mindmaps service returns source note metadata', async () => {
  const ownerId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const noteId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, noteId, title: 'M', content: {} }]) as any,
    createNoteModel([{ _id: noteId, userId: ownerId, title: 'Source note', acl: [] }]) as any,
    noteAccess,
  )

  const result = await service.getById(String(mapId), String(ownerId))

  assert.equal(result.noteId, String(noteId))
  assert.equal(result.noteTitle, 'Source note')
})

test('mindmaps service trims and updates title', async () => {
  const ownerId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, title: 'Old', content: {} }]) as any,
    createNoteModel() as any,
    noteAccess,
  )

  const result = await service.update(String(mapId), String(ownerId), { title: '  New title  ' })

  assert.equal(result.title, 'New title')
})

test('mindmaps service rejects an empty title update', async () => {
  const ownerId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, title: 'Old', content: {} }]) as any,
    createNoteModel() as any,
    noteAccess,
  )

  await assert.rejects(
    () => service.update(String(mapId), String(ownerId), { title: '   ' }),
    /Mindmap title is required/,
  )
})
