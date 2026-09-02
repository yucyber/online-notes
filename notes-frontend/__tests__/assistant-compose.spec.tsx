import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import AssistantCompose from '@/components/assistant/AssistantCompose'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof AssistantCompose>

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    value: '',
    onChange: jest.fn(),
    onSend: jest.fn(),
    generating: false,
    forceNotes: false,
    onToggleForceNotes: jest.fn(),
    ...overrides,
  }
  const view = render(<AssistantCompose {...props} />)
  return { props, view }
}

describe('AssistantCompose', () => {
  test('Enter 触发发送，Shift+Enter 不触发', () => {
    const { props } = setup({ value: '你好' })
    const textbox = screen.getByRole('textbox')
    fireEvent.keyDown(textbox, { key: 'Enter' })
    expect(props.onSend).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true })
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })

  test.each(['', '   '])('值为 %p 时发送按钮禁用', (value) => {
    setup({ value })
    expect(screen.getByLabelText('发送')).toBeDisabled()
  })

  test('非空值时发送按钮可用并触发 onSend', () => {
    const { props } = setup({ value: '你好' })
    const send = screen.getByLabelText('发送')
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })

  test('搜索笔记开关 aria-pressed 随 forceNotes 变化且点击触发回调', () => {
    const onToggleForceNotes = jest.fn()
    const { props, view } = setup({ onToggleForceNotes })
    const toggle = screen.getByRole('button', { name: '搜索笔记' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(onToggleForceNotes).toHaveBeenCalledTimes(1)
    view.rerender(<AssistantCompose {...props} forceNotes />)
    expect(screen.getByRole('button', { name: '搜索笔记' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('生成中且提供 onStop 时显示停止按钮并隐藏发送', () => {
    const onStop = jest.fn()
    setup({ value: '你好', generating: true, onStop })
    expect(screen.getByLabelText('停止生成')).toBeInTheDocument()
    expect(screen.queryByLabelText('发送')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('停止生成'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  test('生成中但未提供 onStop 时回落发送按钮', () => {
    setup({ value: '你好', generating: true })
    expect(screen.queryByLabelText('停止生成')).not.toBeInTheDocument()
    expect(screen.getByLabelText('发送')).toBeInTheDocument()
  })
})
