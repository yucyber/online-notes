import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryTimeline } from '@/components/assistant/MemoryTimeline'

type MemoryOver = Partial<{
  id: string; kind: string; subject: string; statement: string; status: 'confirmed' | 'superseded';
  evidenceStatus: 'ok' | 'stale'; scope: { type: string; id?: string };
  relation?: { type: string; targetMemoryId: string };
  validFrom?: string; validTo?: string; updatedAt: string;
}>

function memory(over: MemoryOver = {}) {
  return {
    id: 'new', kind: 'decision', subject: '布局', statement: '保留浮层',
    scope: { type: 'global' }, status: 'confirmed' as const, evidenceStatus: 'ok' as const,
    validFrom: '2026-09-02T00:00:00.000Z', updatedAt: '', ...over,
  }
}

const items = [
  memory({
    id: 'old', statement: '用大侧栏', status: 'superseded', validFrom: '2026-09-01T00:00:00.000Z',
    validTo: '2026-09-02T00:00:00.000Z',
  }),
  memory({ id: 'new', statement: '保留浮层', relation: { type: 'supersedes', targetMemoryId: 'old' } }),
]

test('默认展示当前有效，切换后展示被替代条目', () => {
  render(<MemoryTimeline items={items} />)
  expect(screen.getByText('保留浮层')).toBeInTheDocument()
  expect(screen.queryByText('用大侧栏')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '演进过程' }))
  expect(screen.getByText('用大侧栏')).toBeInTheDocument()
  expect(screen.getByText('已被替代')).toBeInTheDocument()
})

test('演进过程按 validFrom 升序排列完整链', () => {
  render(<MemoryTimeline items={items} />)
  fireEvent.click(screen.getByRole('button', { name: '演进过程' }))
  const rows = screen.getAllByRole('listitem')
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining('用大侧栏'),
    expect.stringContaining('保留浮层'),
  ])
})

test('stale 证据在当前有效条目上标记并暴露删除/刷新入口', () => {
  const onDelete = jest.fn()
  const onRefresh = jest.fn()
  render(<MemoryTimeline
    items={[memory({ id: 'm1', statement: '保留浮层', evidenceStatus: 'stale' })]}
    onDelete={onDelete}
    onRefreshEvidence={onRefresh}
  />)
  expect(screen.getByText('证据待复核')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(onDelete).toHaveBeenCalledWith('m1')
  fireEvent.click(screen.getByRole('button', { name: '刷新证据' }))
  expect(onRefresh).toHaveBeenCalledWith('m1')
})

test('当前没有有效认知时显示空态，演进过程仍列出全部', () => {
  render(<MemoryTimeline items={[memory({ id: 'gone', statement: '被删方案', status: 'superseded' })]} />)
  expect(screen.getByText('当前暂无有效认知')).toBeInTheDocument()
  expect(screen.queryByText('被删方案')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '演进过程' }))
  expect(screen.getByText('被删方案')).toBeInTheDocument()
  expect(screen.getByText('已被替代')).toBeInTheDocument()
})
