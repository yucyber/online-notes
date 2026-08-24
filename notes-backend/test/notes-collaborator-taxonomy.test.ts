import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotesService } from '../src/modules/notes/notes.service'
import { NoteAccessService } from '../src/modules/notes/note-access.service'

const collaboratorId = '507f1f77bcf86cd799439012'
const ownerId = '507f1f77bcf86cd799439013'
const categoryId = '507f1f77bcf86cd799439101'
const tagId = '507f1f77bcf86cd799439102'

test('协作者的笔记列表返回所有者分类和标签的可展示信息', async () => {
  const noteModel = {
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            maxTimeMS: () => ({
              select: () => ({
                lean: () => ({
                  exec: async () => [{
                    _id: 'note-1',
                    title: '共享笔记',
                    content: '',
                    userId: ownerId,
                    categoryId,
                    tags: [tagId],
                  }],
                }),
              }),
            }),
          }),
        }),
      }),
    }),
    countDocuments: async () => 1,
  }
  const categories = {
    findRefsByIds: async () => [{ id: categoryId, name: '项目', color: '#3b7fbd' }],
  }
  const tags = {
    findRefsByIds: async () => [{ id: tagId, name: '协作', color: '#2f9e6e' }],
  }
  const service = new NotesService(
    noteModel as any,
    categories as any,
    tags as any,
    {} as any,
    {} as any,
    new NoteAccessService(),
    {} as any,
    {
      getListRevision: async () => '0',
      getList: async () => null,
      setList: async () => undefined,
    } as any,
    { record: async () => undefined } as any,
    { findById: async () => null } as any,
  )

  const result = await service.findAll(collaboratorId)

  assert.deepEqual((result.items[0] as any).category, {
    id: categoryId,
    name: '项目',
    color: '#3b7fbd',
  })
  assert.deepEqual((result.items[0] as any).tags, [{
    id: tagId,
    name: '协作',
    color: '#2f9e6e',
  }])
})
