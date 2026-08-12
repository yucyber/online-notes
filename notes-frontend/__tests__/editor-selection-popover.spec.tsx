import { render, screen } from '@testing-library/react'
import { TiptapAiActions } from '@/components/editor/TiptapAiActions'

describe('文本选择浮层整合 AI 入口', () => {
  const editor = {
    state: { selection: { from: 0, to: 5 }, doc: { textBetween: () => 'hello' } },
    chain: () => ({ focus: () => ({ insertContent: () => ({ run: () => {} }) }) }),
  } as any

  it('bubble 模式同时暴露 AI 续写、润色与摘要入口', () => {
    render(<TiptapAiActions editor={editor} readOnly={false} aiWritingType={null} setAiWritingType={() => {}} mode="bubble" />)
    expect(screen.getByRole('button', { name: 'AI 续写' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 润色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 摘要' })).toBeInTheDocument()
  })

  it('continue 模式仍是独立的单一续写入口', () => {
    render(<TiptapAiActions editor={editor} readOnly={false} aiWritingType={null} setAiWritingType={() => {}} mode="continue" />)
    expect(screen.getByRole('button', { name: 'AI 续写' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 摘要' })).not.toBeInTheDocument()
  })
})
