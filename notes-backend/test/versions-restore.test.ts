import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { VersionsService } from '../src/modules/versions/versions.service'

const noteId = new Types.ObjectId('507f1f77bcf86cd799439011')
const userId = '507f1f77bcf86cd799439012'

function execResult<T>(value: T) {
  return { exec: async () => value }
}

test('VersionsService.restore refreshes derived fields after restoring content', async () => {
  let saveCalls = 0
  let refreshCalls = 0
  const note: any = {
    _id: noteId,
    title: 'old title',
    content: 'old content',
    tags: [],
    categoryIds: [],
    save: async () => { saveCalls++ },
  }
  const version = {
    title: 'restored title',
    content: 'restored content',
    tags: [],
    categoryId: undefined,
    categoryIds: [],
  }
  const service = new (VersionsService as any)(
    { findOne: (scope: any) => execResult(scope && note) },
    { findOne: () => execResult(version) },
    { ownerScope: (targetNoteId: string, targetUserId: string) => ({ targetNoteId, targetUserId }) },
    { record: async () => undefined },
    { refreshDerivedFields: async (restored: any) => {
      refreshCalls++
      assert.equal(restored.content, 'restored content')
    } },
  )

  await service.restore(String(noteId), 3, userId)

  assert.equal(saveCalls, 1)
  assert.equal(refreshCalls, 1)
})
