import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import AssistantContextPanel from '@/components/assistant/AssistantContextPanel'

// 认知标签在 AssistantContextPanel 内部拉取数据（fetch），此处以全局 fetch mock 驱动完整链路
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as any)

const candidate = {
  id: 'c1', kind: 'decision', subject: '布局', statement: '保留浮层',
  scope: { type: 'global' }, confidence: 0.9,
  evidence: [{ type: 'message', messageId: 'm1', excerpt: '对话证据' }],
  createdAt: '2026-09-01T00:00:00.000Z',
}

const renderPanel = () => render(
  <AssistantContextPanel
    tab="citations"
    onTabChange={jest.fn()}
    citations={[]}
    evidence={null}
    conversation={null}
    open
    onOpenCitation={jest.fn()}
    onBackToCitations={jest.fn()}
    onClosePanel={jest.fn()}
    onLocate={jest.fn()}
  />,
)

test('确认冲突后点"修改新结论"：触发 resolve reject_memory 把候选退回 pending 并刷新列表', async () => {
  let candidateFetches = 0
  const fetchMock = jest.fn(async (url: string) => {
    const href = String(url)
    if (href.includes('/confirm')) {
      // 后端 T4 闭环：确认遇冲突即物化记忆并挂起，返回新记忆 id + 被重叠的既有节点
      return json({ data: { memoryId: 'mem-new', conflict: { memoryId: 'old-mem', subject: '布局', statement: '用大侧栏', scope: { type: 'global' } } } })
    }
    if (href === '/api/assistant/memories/candidates?status=pending') {
      candidateFetches += 1
      // 候选仍为 pending（reject_memory 后后端会把候选退回 pending，前端刷新可见可再编辑）
      return json({ items: [candidate] })
    }
    if (href.startsWith('/api/assistant/memories?includeSuperseded=1')) return json({ items: [] })
    if (href.includes('/resolve')) return json({ data: { status: 'rejected' } })
    return json({})
  }) as any
  global.fetch = fetchMock

  renderPanel()
  fireEvent.click(screen.getByRole('button', { name: /认知/ }))
  expect(await screen.findByText('保留浮层')).toBeInTheDocument()

  // 确认候选 → 服务端返回冲突 → 冲突对话框出现
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  expect(await screen.findByRole('button', { name: '修改新结论' })).toBeInTheDocument()
  expect(screen.getByText('用大侧栏')).toBeInTheDocument()

  const fetchesBeforeResolve = candidateFetches
  fireEvent.click(screen.getByRole('button', { name: '修改新结论' }))
  // modify 是前端流动作：面板转成 resolve reject_memory（删除已物化记忆并退回候选）
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/assistant/memories/mem-new/resolve',
    expect.objectContaining({ method: 'POST' }),
  ))
  const resolveCall = fetchMock.mock.calls.find(([u]: any) => String(u).endsWith('/mem-new/resolve'))
  expect(JSON.parse(resolveCall![1].body)).toEqual({ type: 'reject_memory' })

  // 冲突层关闭且候选列表被重新拉取（候选回到 pending 后可再次编辑）
  await waitFor(() => expect(candidateFetches).toBeGreaterThan(fetchesBeforeResolve))
  expect(screen.queryByRole('button', { name: '修改新结论' })).not.toBeInTheDocument()
  expect(await screen.findByText('保留浮层')).toBeInTheDocument()
})

test('直接点"拒绝新候选"：resolve reject_memory 不经 modify 转发', async () => {
  const fetchMock = jest.fn(async (url: string) => {
    const href = String(url)
    if (href.includes('/confirm')) {
      return json({ data: { memoryId: 'mem-new', conflict: { memoryId: 'old-mem', subject: '布局', statement: '用大侧栏', scope: { type: 'global' } } } })
    }
    if (href === '/api/assistant/memories/candidates?status=pending') return json({ items: [candidate] })
    if (href.startsWith('/api/assistant/memories?includeSuperseded=1')) return json({ items: [] })
    if (href.includes('/resolve')) return json({ data: { status: 'rejected' } })
    return json({})
  }) as any
  global.fetch = fetchMock

  renderPanel()
  fireEvent.click(screen.getByRole('button', { name: /认知/ }))
  await screen.findByText('保留浮层')
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await screen.findByRole('button', { name: '拒绝新候选' })
  fireEvent.click(screen.getByRole('button', { name: '拒绝新候选' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/assistant/memories/mem-new/resolve',
    expect.objectContaining({ method: 'POST' }),
  ))
  const resolveCall = fetchMock.mock.calls.find(([u]: any) => String(u).endsWith('/mem-new/resolve'))
  expect(JSON.parse(resolveCall![1].body)).toEqual({ type: 'reject_memory' })
})
