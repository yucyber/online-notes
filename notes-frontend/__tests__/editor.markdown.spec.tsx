import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import MarkdownEditor from '@/components/editor/MarkdownEditor'

describe('MarkdownEditor 边界', () => {
  it('全区域输入与快捷保存', () => {
    const onSave = vi.fn(async () => {})
    const onSaveDraft = vi.fn(async () => {})
    render(<MarkdownEditor initialContent={''} initialTitle={'t'} onSave={onSave} onSaveDraft={onSaveDraft} isNew draftKey={'new'} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.click(textarea)
    fireEvent.change(textarea, { target: { value: 'abc' } })
    fireEvent.keyDown(textarea, { ctrlKey: true, key: 's' })
    expect(onSave).toHaveBeenCalled()
  })
})

