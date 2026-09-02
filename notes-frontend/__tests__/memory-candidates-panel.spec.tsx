import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryCandidatesPanel } from '@/components/assistant/MemoryCandidatesPanel'

type CandidateOver = Partial<{
  id: string; kind: string; subject: string; statement: string; confidence: number;
  scope: { type: string; id?: string };
  evidence: Array<{ type: string; messageId?: string; noteId?: string; chunkId?: string; excerpt: string }>;
  createdAt: string;
}>

function candidate(over: CandidateOver = {}) {
  return {
    id: 'c1', kind: 'decision', subject: '界面', statement: '保留现有浮层',
    scope: { type: 'global' }, confidence: 0.9,
    evidence: [{ type: 'message', messageId: 'm1', excerpt: '我决定保留浮层' }],
    createdAt: '2026-09-01T00:00:00.000Z', ...over,
  }
}

test('渲染待确认候选与确认/拒绝操作', () => {
  const onConfirm = jest.fn()
  const onReject = jest.fn()
  render(<MemoryCandidatesPanel items={[candidate()]} onConfirm={onConfirm} onReject={onReject} />)
  expect(screen.getByText('决策')).toBeInTheDocument()
  expect(screen.getByText('保留现有浮层')).toBeInTheDocument()
  screen.getByRole('button', { name: '确认' }).click()
  expect(onConfirm).toHaveBeenCalledWith('c1', {})
  screen.getByRole('button', { name: '拒绝' }).click()
  expect(onReject).toHaveBeenCalledWith('c1', '')
})

test('kind 徽标覆盖七种映射，附置信度与证据来源', () => {
  const kinds = ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson']
  const labelOf: Record<string, string> = {
    decision: '决策', preference: '偏好', fact: '事实', hypothesis: '假设',
    open_question: '待确认问题', constraint: '约束', lesson: '经验',
  }
  const items = kinds.map((kind, index) => candidate({
    id: `k${index}`, kind, subject: `主题${index}`, statement: `结论${index}`,
    confidence: 0.66, evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: '来自笔记' }],
  }))
  render(<MemoryCandidatesPanel items={items} onConfirm={jest.fn()} onReject={jest.fn()} />)
  kinds.forEach((kind) => {
    expect(screen.getByText(labelOf[kind])).toBeInTheDocument()
  })
  expect(screen.getAllByText('置信度 66%')).toHaveLength(kinds.length)
  expect(screen.getAllByText('来自笔记')).toHaveLength(kinds.length)
})

test('查看依据展开证据摘要，来源区分对话与笔记', () => {
  const items = [
    candidate({ id: 'c1', statement: '保留浮层', evidence: [{ type: 'message', messageId: 'm1', excerpt: '我在对话里说的' }] }),
    candidate({ id: 'c2', statement: '分页方案', evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: '笔记里的片段' }] }),
  ]
  render(<MemoryCandidatesPanel items={items} onConfirm={jest.fn()} onReject={jest.fn()} />)
  const expands = screen.getAllByRole('button', { name: '查看依据' })
  expect(expands).toHaveLength(2)
  expect(screen.queryByText('我在对话里说的')).not.toBeInTheDocument()
  fireEvent.click(expands[0])
  expect(screen.getByText('我在对话里说的')).toBeInTheDocument()
  expect(screen.getByText('来自对话')).toBeInTheDocument()
  fireEvent.click(expands[1])
  expect(screen.getByText('笔记里的片段')).toBeInTheDocument()
  expect(screen.getByText('来自笔记')).toBeInTheDocument()
})

test('修改后确认以内联表单编辑 kind/subject/statement/scope 后携带编辑值确认', () => {
  const onConfirm = jest.fn()
  render(<MemoryCandidatesPanel items={[candidate()]} onConfirm={onConfirm} onReject={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '修改后确认' }))
  expect(screen.getByLabelText('类型')).toHaveValue('decision')
  fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'fact' } })
  fireEvent.change(screen.getByLabelText('主题'), { target: { value: '界面形态' } })
  fireEvent.change(screen.getByLabelText('表述'), { target: { value: '改用浮动气泡' } })
  fireEvent.change(screen.getByLabelText('适用范围'), { target: { value: 'conversation' } })
  fireEvent.change(screen.getByLabelText('范围 ID'), { target: { value: 'conv-9' } })
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  expect(onConfirm).toHaveBeenCalledWith('c1', {
    kind: 'fact', subject: '界面形态', statement: '改用浮动气泡',
    scope: { type: 'conversation', id: 'conv-9' },
  })
})

test('拒绝可先填写原因，确认后携带原因回调', () => {
  const onReject = jest.fn()
  render(<MemoryCandidatesPanel items={[candidate()]} onConfirm={jest.fn()} onReject={onReject} />)
  fireEvent.click(screen.getByRole('button', { name: '填写拒绝原因' }))
  fireEvent.change(screen.getByLabelText('拒绝原因'), { target: { value: '表述不准确' } })
  fireEvent.click(screen.getByRole('button', { name: '确认拒绝' }))
  expect(onReject).toHaveBeenCalledWith('c1', '表述不准确')
})

test('同 kind 同 scope 提供批量确认，先预览将写入内容再提交', () => {
  const onBatch = jest.fn()
  const items = [
    candidate({ id: 'c1', statement: '结论一' }),
    candidate({ id: 'c2', statement: '结论二' }),
  ]
  render(<MemoryCandidatesPanel items={items} onConfirm={jest.fn()} onReject={jest.fn()} onBatchConfirm={onBatch} />)
  expect(screen.getByText('2 条待确认（决策 · 全局）可批量确认')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '批量确认' }))
  // 先展示将写入内容，再提交
  expect(screen.getByText('将写入以下 2 条认知')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '确认写入 2 条' }))
  expect(onBatch).toHaveBeenCalledWith(['c1', 'c2'], 'decision', { type: 'global' })
})

test('无候选时显示空态提示', () => {
  render(<MemoryCandidatesPanel items={[]} onConfirm={jest.fn()} onReject={jest.fn()} />)
  expect(screen.getByText('暂无待确认的认知候选')).toBeInTheDocument()
})
