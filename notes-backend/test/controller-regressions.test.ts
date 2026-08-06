import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ValidationPipe } from '@nestjs/common'
import { SemanticController } from '../src/modules/semantic/semantic.controller'
import { RecommendationQueryDto } from '../src/modules/notes/dto'

test('RecommendationQueryDto accepts currentNoteId under global whitelist validation', async () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
  const currentNoteId = '507f1f77bcf86cd799439011'

  const result = await pipe.transform(
    { currentNoteId, limit: '3', keyword: 'alpha' },
    { type: 'query', metatype: RecommendationQueryDto, data: '' },
  ) as RecommendationQueryDto

  assert.equal(result.currentNoteId, currentNoteId)
  assert.equal(result.limit, 3)
  assert.equal(result.keyword, 'alpha')
})

test('SemanticController returns keyword search results for keyword mode', async () => {
  const expected = {
    page: 1,
    limit: 5,
    total: 1,
    totalPages: 1,
    hasNext: false,
    data: [{ id: 'note-1', title: 'Updated', preview: 'Updated body', score: 0, updatedAt: '2026-06-04' }],
  }
  const semantic = {
    search: async (q: string, userId: string, opts: any) => {
      assert.equal(q, 'Updated')
      assert.equal(userId, 'user-1')
      assert.equal(opts.mode, 'keyword')
      assert.equal(opts.limit, 5)
      return expected
    },
  }
  const controller = new SemanticController(semantic as any)

  const result = await controller.search(
    { user: { id: 'user-1' } },
    'Updated',
    'keyword',
    undefined,
    5,
  )

  assert.deepEqual(result, expected)
})
