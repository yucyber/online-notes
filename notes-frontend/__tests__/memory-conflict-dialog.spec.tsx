import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryConflictDialog } from '@/components/assistant/MemoryConflictDialog'

test('冲突对话框提供四个解决方向', () => {
  const onResolve = jest.fn()
  render(<MemoryConflictDialog
    conflict={{ memoryId: 'new', subject: '布局', statement: '保留浮层' }}
    existing={{ memoryId: 'old', subject: '布局', statement: '用大侧栏' }}
    onResolve={onResolve}
  />)
  screen.getByRole('button', { name: '用新结论替代旧结论' }).click()
  expect(onResolve).toHaveBeenCalledWith('new', { type: 'supersede', targetMemoryId: 'old' })
})

test('展示新旧两条结论以便对照', () => {
  render(<MemoryConflictDialog
    conflict={{ memoryId: 'new', subject: '布局', statement: '保留浮层' }}
    existing={{ memoryId: 'old', subject: '布局', statement: '用大侧栏' }}
    onResolve={jest.fn()}
  />)
  expect(screen.getByText('新结论')).toBeInTheDocument()
  expect(screen.getByText('保留浮层')).toBeInTheDocument()
  expect(screen.getByText('既有结论')).toBeInTheDocument()
  expect(screen.getByText('用大侧栏')).toBeInTheDocument()
})

test('两者适用不同场景：要求先调整新结论范围再保留', () => {
  const onResolve = jest.fn()
  render(<MemoryConflictDialog
    conflict={{ memoryId: 'new', subject: '布局', statement: '保留浮层' }}
    existing={{ memoryId: 'old', subject: '布局', statement: '用大侧栏' }}
    onResolve={onResolve}
  />)
  fireEvent.click(screen.getByRole('button', { name: '两者适用不同场景' }))
  expect(screen.getByText('保留两条需先为新结论调整适用范围')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '按新范围保留两者' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('新结论范围'), { target: { value: 'note' } })
  fireEvent.click(screen.getByRole('button', { name: '按新范围保留两者' }))
  expect(onResolve).toHaveBeenCalledWith('new', { type: 'keep_both' })
})

test('修改新结论与拒绝新候选分别回调对应动作', () => {
  const onResolve = jest.fn()
  render(<MemoryConflictDialog
    conflict={{ memoryId: 'new', subject: '布局', statement: '保留浮层' }}
    existing={{ memoryId: 'old', subject: '布局', statement: '用大侧栏' }}
    onResolve={onResolve}
  />)
  fireEvent.click(screen.getByRole('button', { name: '修改新结论' }))
  expect(onResolve).toHaveBeenCalledWith('new', { type: 'modify' })
  fireEvent.click(screen.getByRole('button', { name: '拒绝新候选' }))
  expect(onResolve).toHaveBeenCalledWith('new', { type: 'reject_memory' })
})
