import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { BoardsService } from '../src/modules/boards/boards.service'
import { MindmapsService } from '../src/modules/mindmaps/mindmaps.service'

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
                  return Array.isArray(row.acl) && row.acl.some((entry: any) => String(entry.userId) === target)
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
  )

  await assert.rejects(() => service.getById(String(boardId), String(otherId)), /Board not found/)
})

test('boards service allows owner read', async () => {
  const ownerId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, title: 'A', content: {} }]) as any,
    createNoteModel() as any,
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
  )

  await assert.rejects(
    () => service.update(String(boardId), String(collaboratorId), { title: 'Changed' }),
    /Board not found/,
  )
})

test('boards service rejects invalid id with 400', async () => {
  const service = new BoardsService(createModel() as any, createNoteModel() as any)
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
  const service = new BoardsService(model as any, createNoteModel() as any)

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
  )

  await assert.rejects(
    () => service.update(String(mapId), String(otherId), { title: 'Changed' }),
    /Mindmap not found/,
  )
})

test('mindmaps service allows owner update', async () => {
  const ownerId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, title: 'M', content: {} }]) as any,
    createNoteModel() as any,
  )

  const result = await service.update(String(mapId), String(ownerId), { title: 'New' })
  assert.equal(result.title, 'New')
})
