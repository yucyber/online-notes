import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import ChunkEvidenceViewer from '@/components/assistant/ChunkEvidenceViewer'

const evidence = {
  noteId: 'n1', noteTitle: 'React 笔记', chunkId: 'c2', headingPath: ['React', 'Diff'],
  content: '完整 Chunk 正文：Diff 算法逐层对比。', noteUpdatedAt: '2026-09-01T00:00:00.000Z', relocated: true,
  neighbors: {
    before: [{ chunkId: 'c1', headingPath: ['React'], excerpt: '第一段摘要' }],
    after: [{ chunkId: 'c3', headingPath: ['React', 'Diff'], excerpt: '第三段摘要' }],
  },
}

test('展示完整正文、标题路径、重定位徽标与定位链接', async () => {
  // jsdom 无 Node Fetch API（Response 未定义）——用普通对象 mock（仓库惯例，同 assistant-api.spec.ts）
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: evidence }) } as any)) as any
  const onLocated = jest.fn()
  render(<ChunkEvidenceViewer noteId="n1" chunkId="c2" heading={['React', 'Diff']} onLocated={onLocated} />)
  await screen.findByText('React 笔记')
  expect(screen.getByText(/React > Diff/)).toBeInTheDocument()
  expect(screen.getByText('已重新定位')).toBeInTheDocument()
  const link = screen.getByRole('link', { name: '定位到原文' })
  expect(link).toHaveAttribute('href', '/dashboard/notes/n1?chunkId=c2&heading=React+%3E+Diff')
  link.click()
  expect(onLocated).toHaveBeenCalled()
})

test('展开上下文显示相邻 Chunk 摘要', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: evidence }) } as any)) as any
  render(<ChunkEvidenceViewer noteId="n1" chunkId="c2" heading={['React', 'Diff']} />)
  await screen.findByText('React 笔记')
  screen.getByRole('button', { name: '展开上下文' }).click()
  await screen.findByText('第一段摘要')
  expect(screen.getByText('第三段摘要')).toBeInTheDocument()
})

test('失权时显示权限提示而不是历史正文', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: '笔记不存在' }) } as any)) as any
  render(<ChunkEvidenceViewer noteId="n1" chunkId="c2" heading={[]} />)
  await screen.findByText('证据加载失败，请稍后重试。')
  expect(screen.queryByText(/完整 Chunk 正文/)).not.toBeInTheDocument()
})
