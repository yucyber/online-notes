import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NoteRecommendationService } from '../src/modules/notes/note-recommendation.service'

const userId = '507f1f77bcf86cd799439011'

function chain<T>(value: T) {
  const query: any = {
    sort: () => query,
    limit: () => query,
    select: () => query,
    lean: () => query,
    exec: async () => value,
  }
  return query
}

test('NoteRecommendationService never appends drafts beyond the requested limit', async () => {
  const vectorNotes = Array.from({ length: 5 }, (_, index) => ({
    _id: new Types.ObjectId(),
    title: `vector-${index}`,
    content: 'body',
    status: 'published',
    userId: new Types.ObjectId(userId),
  }))
  const draftNotes = [
    { _id: new Types.ObjectId(), title: 'draft-1', status: 'draft' },
    { _id: new Types.ObjectId(), title: 'draft-2', status: 'draft' },
  ]
  const noteModel = {
    findById: () => ({ select: () => ({ exec: async () => ({ _id: new Types.ObjectId(), embedding: [0.1], tags: [] }) }) }),
    aggregate: () => ({ exec: async () => vectorNotes }),
    find: (query: any) => chain(query.status === 'draft' ? draftNotes : []),
  }
  const service = new NoteRecommendationService(noteModel as any)

  const result = await service.getRecommendations(userId, new Types.ObjectId().toString(), 5)

  assert.equal(result.length, 5)
  assert.equal(result.filter((note: any) => note.status === 'draft').length, 0)
})
