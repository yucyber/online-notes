import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import RagCitationList from '@/components/ai/RagCitationList'

test('引用链接使用编辑器支持的 chunkId 参数', () => {
  render(<RagCitationList citations={[{
    evidenceId: 'E1',
    noteId: 'note-1',
    noteTitle: 'React',
    chunkId: 'chunk-1',
    headingPath: ['React', 'Diff'],
    excerpt: 'Diff 内容',
  }]} />)

  expect(screen.getByRole('link', { name: /React/ })).toHaveAttribute(
    'href',
    '/dashboard/notes/note-1?chunkId=chunk-1&heading=React+%3E+Diff',
  )
})
