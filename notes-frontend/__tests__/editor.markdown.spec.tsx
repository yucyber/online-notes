import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => <div>{children as any}</div>,
}))

jest.mock('rehype-raw', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('rehype-sanitize', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: unknown }) => <pre>{children as any}</pre>,
}))

jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  dracula: {},
}))

jest.mock('@/lib/draftStore', () => ({
  getDraft: jest.fn(async () => null),
  putDraft: jest.fn(async () => undefined),
  removeDraft: jest.fn(async () => undefined),
}))

import MarkdownEditor from '@/components/editor/MarkdownEditor'

describe('MarkdownEditor 边界', () => {
  it('全区域输入与快捷保存', () => {
    const onSave = jest.fn(async () => { })
    const onSaveDraft = jest.fn(async () => { })
    render(<MarkdownEditor initialContent={''} initialTitle={'t'} onSave={onSave} onSaveDraft={onSaveDraft} isNew draftKey={'new'} />)
    const textarea = screen.getByPlaceholderText(/使用Markdown格式编写笔记/)
    fireEvent.click(textarea)
    fireEvent.change(textarea, { target: { value: 'abc' } })
    fireEvent.keyDown(textarea, { ctrlKey: true, key: 's' })
    expect(onSave).toHaveBeenCalled()
  })
})
