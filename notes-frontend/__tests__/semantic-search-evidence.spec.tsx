import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SearchHitEvidence } from '@/components/notes/SearchHitEvidence'

const hit = {
  chunkId: 'chunk-1',
  headingPath: ['React', '性能优化'],
  content: 'useMemo 不能解决所有 diff 开销，列表 key 不稳定时仍会导致整棵子树重渲染。',
  score: 0.92,
  matchType: 'semantic' as const,
}

test('展示标题路径、语义标签和额外命中数量', () => {
  render(<SearchHitEvidence noteId="note-1" hit={hit} additionalCount={2} />)

  expect(screen.getByText('React / 性能优化')).toBeInTheDocument()
  expect(screen.getByText('语义相关')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '展开另外命中 2 处' })).toBeInTheDocument()
})

test('点击额外命中按钮只展开当前证据带中的片段', () => {
  render(
    <SearchHitEvidence
      noteId="note-1"
      hit={hit}
      additionalCount={1}
      additionalHits={[{ ...hit, chunkId: 'chunk-2', headingPath: ['React', '陷阱'], content: '额外证据' }]}
    />,
  )

  expect(screen.queryByText('额外证据')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '展开另外命中 1 处' }))
  expect(screen.getByText('额外证据')).toBeInTheDocument()
})
