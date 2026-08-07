import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { CommentsService } from '../src/modules/comments/comments.service'

const noteId = new Types.ObjectId('507f1f77bcf86cd799439011')
const commentId = new Types.ObjectId('507f1f77bcf86cd799439012')
const userId = '507f1f77bcf86cd799439013'

test('CommentsService.reply checks member scope before mutating the comment', async () => {
  let saveCalls = 0
  const comment = {
    _id: commentId,
    noteId,
    replies: [],
    save: async () => { saveCalls++ },
  }
  const scopes: any[] = []
  const service = new CommentsService(
    { findById: () => ({ exec: async () => comment }) } as any,
    {
      findOne: (scope: any) => {
        scopes.push(scope)
        return { exec: async () => null }
      },
    } as any,
    { memberScope: (targetNoteId: string, targetUserId: string) => ({ targetNoteId, targetUserId }) } as any,
    { record: async () => undefined } as any,
  )

  await assert.rejects(() => service.reply(String(commentId), userId, 'reply'), /无权限|not found/i)
  assert.equal(saveCalls, 0)
  assert.deepEqual(scopes, [{ targetNoteId: String(noteId), targetUserId: userId }])
})

test('CommentsService.create keeps its member scope before writing', async () => {
  let created = 0
  const CommentModel = class {
    noteId = noteId
    async save() { created++ }
  }
  const service = new CommentsService(
    CommentModel as any,
    { findOne: () => ({ exec: async () => ({ _id: noteId }) }) } as any,
    { memberScope: (targetNoteId: string, targetUserId: string) => ({ targetNoteId, targetUserId }) } as any,
    { record: async () => undefined } as any,
  )

  await service.create(String(noteId), userId, 1, 2, 'text')

  assert.equal(created, 1)
})
