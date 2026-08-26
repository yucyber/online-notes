import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Breadcrumb } from '@/components/dashboard/dashboard-navigation'

test('最后一级业务面包屑支持原地重命名', async () => {
  const onRename = jest.fn().mockResolvedValue(undefined)
  render(<Breadcrumb pathname="/dashboard/mindmaps/m1" onNavigate={jest.fn()} override={{
    items: [
      { label: '我的笔记', href: '/dashboard/notes' },
      { label: '来源笔记', href: '/dashboard/notes/n1' },
      { label: '旧标题' },
    ],
    onRename,
  }} />)

  fireEvent.click(screen.getByRole('button', { name: '编辑思维导图标题' }))
  const input = screen.getByRole('textbox', { name: '思维导图标题' })
  fireEvent.change(input, { target: { value: '新标题' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  await waitFor(() => expect(onRename).toHaveBeenCalledWith('新标题'))
})
