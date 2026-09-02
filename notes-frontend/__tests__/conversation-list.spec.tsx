import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ConversationList } from '@/components/assistant/ConversationList'

const now = new Date('2026-09-01T12:00:00.000Z').getTime()
const items = [
  { id: 'c-today', title: '今天会话', status: 'active' as const, messageCount: 3, updatedAt: new Date(now - 3_600_000).toISOString() },
  { id: 'c-week', title: '上周会话', status: 'active' as const, messageCount: 1, updatedAt: new Date(now - 5 * 86_400_000).toISOString() },
  { id: 'c-old', title: '', status: 'active' as const, messageCount: 0, updatedAt: new Date(now - 30 * 86_400_000).toISOString() },
]

test('按时间分组渲染且未命名会话显示新对话', () => {
  render(<ConversationList items={items} activeId="c-week" onSelect={() => undefined} onNew={() => undefined} />)
  expect(screen.getByText('今天')).toBeInTheDocument()
  expect(screen.getByText('最近 7 天')).toBeInTheDocument()
  expect(screen.getByText('更早')).toBeInTheDocument()
  expect(screen.getByText('新对话')).toBeInTheDocument()
  const active = screen.getByRole('button', { name: /上周会话/ })
  expect(active).toHaveAttribute('aria-current', 'true')
})

test('点击会话与新建按钮触发回调', () => {
  const onSelect = jest.fn()
  const onNew = jest.fn()
  render(<ConversationList items={items} activeId={undefined} onSelect={onSelect} onNew={onNew} />)
  screen.getByRole('button', { name: /今天会话/ }).click()
  expect(onSelect).toHaveBeenCalledWith('c-today')
  screen.getByRole('button', { name: '新建会话' }).click()
  expect(onNew).toHaveBeenCalled()
})

// 合并自计划 2 Task 8：管理操作菜单
test('操作菜单触发重命名/归档/删除回调', () => {
  const onRename = jest.fn()
  const onArchive = jest.fn()
  const onDelete = jest.fn()
  // handleRename 走 window.prompt——jsdom 需 mock 返回标题，否则 null 截断不触发 onRename
  const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('新标题')
  render(<ConversationList items={items} activeId={undefined} onSelect={() => undefined} onNew={() => undefined} onRename={onRename} onArchive={onArchive} onDelete={onDelete} />)
  fireEvent.click(screen.getByRole('button', { name: /重命名 今天会话/ }))
  expect(promptSpy).toHaveBeenCalled()
  expect(onRename).toHaveBeenCalledWith('c-today', '新标题')
  fireEvent.click(screen.getByRole('button', { name: /归档 今天会话/ }))
  expect(onArchive).toHaveBeenCalledWith('c-today')
  fireEvent.click(screen.getByRole('button', { name: /删除 今天会话/ }))
  expect(onDelete).toHaveBeenCalledWith('c-today')
  promptSpy.mockRestore()
})
