import MindmapsPage from '@/app/dashboard/mindmaps/page'
import { redirect } from 'next/navigation'

jest.mock('next/navigation', () => ({ redirect: jest.fn() }))

test('思维导图索引重定向到我的笔记', () => {
  MindmapsPage()
  expect(redirect).toHaveBeenCalledWith('/dashboard/notes')
})
