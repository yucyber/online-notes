import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import TiptapEditor from '@/components/editor/TiptapEditor'

describe('TiptapEditor 全区域输入', () => {
  const user = { id: 'u1', name: 'User One' }
  beforeEach(() => { (process as any).env.NEXT_PUBLIC_YWS_URL = '' })

  it('容器空白点击聚焦并在文末输入', () => {
    const onSave = vi.fn()
    render(<TiptapEditor noteId="n1" initialHTML={'<p>abc</p>'} onSave={async () => onSave('')} user={user} />)
    const container = screen.getByText(/连接状态：/).closest('div')!.nextElementSibling as HTMLElement
    const evt = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(evt, 'target', { value: container })
    Object.defineProperty(evt, 'currentTarget', { value: container })
    container.dispatchEvent(evt)
    const editable = document.querySelector('.ProseMirror') as HTMLElement
    editable.focus()
    fireEvent.keyDown(editable, { key: 'a' })
    expect(editable).toBeInTheDocument()
  })

  it('只读态禁用保存', () => {
    const onSave = vi.fn()
    render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} readOnly />)
    const saveBtn = screen.getByRole('button', { name: '保存' })
    expect(saveBtn).toBeDisabled()
  })
})

