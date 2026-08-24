import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotesService } from '../src/modules/notes/notes.service'
import { NoteAccessService } from '../src/modules/notes/note-access.service'

const userId = '507f1f77bcf86cd799439012'

test('NotesService.findAll selects note content for list preview fallback', async () => {
  let selectedFields = ''
  let cachePayload: Record<string, unknown> | undefined
  const noteModel = {
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            maxTimeMS: () => ({
              select: (fields: string) => {
                selectedFields = fields
                return {
                  lean: () => ({
                    exec: async () => [
                      {
                        _id: 'note-1',
                        title: 'No summary yet',
                        content: '<p>Preview body</p>',
                        tags: [],
                        createdAt: new Date('2026-06-05T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-05T00:00:00.000Z'),
                      },
                    ],
                  }),
                }
              },
            }),
          }),
        }),
      }),
    }),
    countDocuments: async () => 1,
  }
  const service = new NotesService(
    noteModel as any,
    { findRefsByIds: async () => [] } as any,
    { findRefsByIds: async () => [] } as any,
    {} as any,
    {} as any,
    new NoteAccessService(),
    {} as any,
    {
      getListRevision: async () => '0',
      getList: async (_userId: string, payload: Record<string, unknown>) => {
        cachePayload = payload
        return null
      },
      setList: async () => undefined,
    } as any,
    { record: async () => undefined } as any,
    { findById: async () => null } as any,
  )

  const result = await service.findAll(userId)

  assert.equal(cachePayload?.previewFieldsVersion, 'content-taxonomy-v2')
  assert.match(selectedFields, /\bcontent\b/)
  assert.equal((result.items[0] as any).content, '<p>Preview body</p>')
})
