import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockAiRunsAPI = {
  getPerformance: jest.fn(),
  getRun: jest.fn(),
}

const router = { replace: jest.fn() }

jest.mock('next/navigation', () => ({
  useRouter: () => router,
}))

jest.mock('@/lib/auth', () => ({
  getCurrentUser: () => ({
    id: 'user-1',
    email: 'user@example.com',
    displayName: '林默',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  }),
  logout: jest.fn(async () => undefined),
  setCurrentUser: jest.fn(),
}))

jest.mock('@/lib/api/users', () => ({
  usersAPI: { updateProfile: jest.fn() },
}))

jest.mock('@/components/editor/useEditorLayoutPreferences', () => ({
  useEditorLayoutPreferences: () => ({
    autoSaveLayout: true,
    setAutoSaveLayout: jest.fn(),
  }),
}))

jest.mock('@/lib/api/ai-runs', () => ({
  aiRunsAPI: mockAiRunsAPI,
}))

const recentRun = {
  runId: 'run-knowledge-1',
  graphName: 'KnowledgeGraphBuildGraph',
  task: 'knowledge_graph',
  reasoningMode: 'auto',
  provider: 'siliconflow',
  model: 'deepseek-v3',
  durationMs: 19200,
  retryCount: 0,
  fallbackUsed: false,
  finishReason: 'stop',
  contentChars: 640,
  reasoningChars: 120,
  validationResult: 'valid',
  stages: [
    { name: 'context_prepare', durationMs: 900, status: 'succeeded' },
    { name: 'provider', durationMs: 17800, status: 'succeeded', provider: 'siliconflow', model: 'deepseek-v3' },
    { name: 'validation', durationMs: 500, status: 'succeeded' },
  ],
  metrics: { candidateNotes: 8, candidateChunks: 24, outputChars: 640 },
  status: 'succeeded',
  createdAt: '2026-08-30T08:00:00.000Z',
  updatedAt: '2026-08-30T08:00:19.200Z',
  finishedAt: '2026-08-30T08:00:19.200Z',
}

const legacyRun = {
  ...recentRun,
  runId: 'run-legacy-1',
  task: 'writer',
  graphName: 'WriterGraph',
  durationMs: 2400,
  stages: [],
  createdAt: '2026-08-29T08:00:00.000Z',
}

function performanceResult(overrides: Record<string, unknown> = {}) {
  return {
    requestCount: 12,
    successRate: 0.917,
    fallbackRate: 0.083,
    p50Ms: 2400,
    p95Ms: 19200,
    byTask: [
      {
        task: 'knowledge_graph',
        requestCount: 5,
        successRate: 1,
        fallbackRate: 0,
        p50Ms: 15500,
        p95Ms: 19200,
        stages: [
          { name: 'context_prepare', requestCount: 5, p50Ms: 850, p95Ms: 900 },
          { name: 'provider', requestCount: 5, p50Ms: 14000, p95Ms: 17800 },
          { name: 'validation', requestCount: 5, p50Ms: 450, p95Ms: 500 },
        ],
      },
      {
        task: 'writer',
        requestCount: 7,
        successRate: 0.857,
        fallbackRate: 0.143,
        p50Ms: 1800,
        p95Ms: 4200,
        stages: [],
      },
    ],
    recentRuns: {
      items: [recentRun, legacyRun],
      page: 1,
      size: 10,
      total: 11,
      totalPages: 2,
    },
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('AI performance settings panel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.history.replaceState({}, '', '/dashboard/settings')
    mockAiRunsAPI.getPerformance.mockResolvedValue(performanceResult())
    mockAiRunsAPI.getRun.mockResolvedValue(recentRun)
  })

  it('loads only after entering AI performance and exposes readable metrics, filters, stages, history and pagination', async () => {
    const { default: SettingsPage } = await import('@/app/dashboard/settings/page')
    render(<SettingsPage />)

    expect(mockAiRunsAPI.getPerformance).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'AI 性能' }))

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('91.7%')).toBeInTheDocument()
    expect(screen.getByText('8.3%')).toBeInTheDocument()
    expect(screen.getByText('P50 2.4 秒')).toBeInTheDocument()
    expect(screen.getByText('P95 19.2 秒')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'AI 任务' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '时间范围' })).toBeInTheDocument()
    expect(screen.getAllByText('准备数据').length).toBeGreaterThan(0)
    expect(screen.getAllByText('模型调用').length).toBeGreaterThan(0)
    expect(screen.getByText('旧记录')).toBeInTheDocument()
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(mockAiRunsAPI.getPerformance).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.any(AbortSignal),
      )
    })

    const detailTrigger = screen.getAllByRole('button', { name: '查看详情' })[0]
    fireEvent.click(detailTrigger)
    const dialog = await screen.findByRole('dialog', { name: 'AI 请求详情' })
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(dialog).getByText('总耗时 19.2 秒')).toBeInTheDocument()
    expect(within(dialog).getByText('模型调用')).toBeInTheDocument()
    expect(within(dialog).getByText('17.8 秒')).toBeInTheDocument()
    expect(within(dialog).getAllByText('deepseek-v3').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('首次调用')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'AI 请求详情' })).not.toBeInTheDocument()
    await waitFor(() => expect(detailTrigger).toHaveFocus())
    expect(document.body.style.overflow).toBe('')
  })

  it('loads when the settings URL directly enters the AI performance group', async () => {
    window.history.replaceState({}, '', '/dashboard/settings#ai-performance')
    const { default: SettingsPage } = await import('@/app/dashboard/settings/page')

    render(<SettingsPage />)

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(mockAiRunsAPI.getPerformance).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'AI 性能' })).toHaveAttribute('aria-current', 'location')
  })

  it('returns to the default settings group when browser navigation clears the hash', async () => {
    const { default: SettingsPage } = await import('@/app/dashboard/settings/page')
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('link', { name: 'AI 性能' }))
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI 性能' })).toHaveAttribute('aria-current', 'location')

    window.location.hash = ''

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '账户信息' })).toHaveAttribute('aria-current', 'location')
    })
    expect(screen.getByRole('link', { name: 'AI 性能' })).not.toHaveAttribute('aria-current', 'location')
  })

  it('ignores a slower stale response after task filters change', async () => {
    const stale = deferred<ReturnType<typeof performanceResult>>()
    mockAiRunsAPI.getPerformance
      .mockResolvedValueOnce(performanceResult())
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce(performanceResult({ requestCount: 4, recentRuns: { items: [], page: 1, size: 10, total: 0, totalPages: 0 } }))
    const { AiPerformancePanel } = await import('@/components/settings/AiPerformancePanel')
    render(<AiPerformancePanel />)

    expect(await screen.findByText('12')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'AI 任务' }), { target: { value: 'knowledge_graph' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'AI 任务' }), { target: { value: 'writer' } })

    expect(await screen.findByText('4')).toBeInTheDocument()
    stale.resolve(performanceResult({ requestCount: 99 }))
    await waitFor(() => expect(screen.queryByText('99')).not.toBeInTheDocument())
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('changes the date filter and offers an accessible retry after a load failure', async () => {
    mockAiRunsAPI.getPerformance
      .mockRejectedValueOnce(new Error('sensitive upstream details'))
      .mockResolvedValueOnce(performanceResult({ requestCount: 3 }))
      .mockResolvedValueOnce(performanceResult({ requestCount: 30 }))
    const { AiPerformancePanel } = await import('@/components/settings/AiPerformancePanel')
    render(<AiPerformancePanel />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('AI 性能数据加载失败，请重试')
    expect(alert).not.toHaveTextContent('sensitive upstream details')
    fireEvent.click(within(alert).getByRole('button', { name: '重试加载 AI 性能数据' }))
    expect(await screen.findByText('3')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '时间范围' }), { target: { value: '30' } })
    expect(await screen.findByText('30')).toBeInTheDocument()
    expect(mockAiRunsAPI.getPerformance).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
      expect.any(AbortSignal),
    )
  })
})
