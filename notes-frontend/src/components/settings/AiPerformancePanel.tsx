'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
import { aiRunsAPI, type AiRun, type AiRunPerformance } from '@/lib/api/ai-runs'
import { AiRunWaterfall, formatAiDuration, getAiStageLabel } from './AiRunWaterfall'

const PAGE_SIZE = 10
const dayMs = 24 * 60 * 60 * 1000

const taskLabels: Record<string, string> = {
  aggregate_summary: '聚合摘要',
  knowledge_graph: '知识图谱',
  mindmap: '思维导图',
  note_summary: '笔记摘要',
  writer: 'AI 写作',
}

const statusLabels = {
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
}

function formatRate(rate: number) {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(rate * 100)}%`
}

function taskLabel(task?: string) {
  if (!task) return '未知任务'
  return taskLabels[task] || task
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--product-line)] bg-[var(--product-panel)] p-3">
      <p className="text-xs text-[var(--product-muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--product-text)]">{value}</p>
      {detail ? <p className="mt-1 text-xs tabular-nums text-[var(--product-text-secondary)]">{detail}</p> : null}
    </div>
  )
}

function RunDetails({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<AiRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void aiRunsAPI.getRun(runId, controller.signal).then(setRun).catch(() => {
      if (!controller.signal.aborted) {
        setError(true)
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [retry, runId])

  useEffect(() => {
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,[tabindex]:not([tabindex="-1"])') || [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/45" role="dialog" aria-modal="true" aria-label="AI 请求详情">
      <button type="button" tabIndex={-1} className="absolute inset-0 cursor-default" aria-label="关闭 AI 请求详情" onClick={onClose} />
      <aside ref={drawerRef} onKeyDown={trapFocus} className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-[var(--product-line)] bg-[var(--product-panel)] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--product-line)] bg-[var(--product-panel)] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--product-text)]">AI 请求详情</h3>
            <p className="mt-0.5 text-xs text-[var(--product-muted)]">仅展示当前账户可访问的运行指标</p>
          </div>
          <button ref={closeRef} type="button" aria-label="关闭 AI 请求详情" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg text-[var(--product-muted)] transition hover:bg-[var(--product-surface-hover)] hover:text-[var(--product-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)]">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-6 p-5">
          {loading ? <p role="status" className="text-sm text-[var(--product-muted)]">正在加载请求详情…</p> : null}
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-[var(--product-line)] p-3 text-sm text-[var(--product-text-secondary)]">
              <span>请求详情加载失败，请重试</span>
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="rounded-lg px-3 py-2 font-medium text-[var(--product-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)]">重试</button>
            </div>
          ) : null}
          {run ? (
            <>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                <div><dt className="text-xs text-[var(--product-muted)]">任务</dt><dd className="mt-1 text-[var(--product-text)]">{taskLabel(run.task)}</dd></div>
                <div><dt className="text-xs text-[var(--product-muted)]">状态</dt><dd className="mt-1 text-[var(--product-text)]">{statusLabels[run.status]}</dd></div>
                <div><dt className="text-xs text-[var(--product-muted)]">总耗时</dt><dd className="mt-1 tabular-nums text-[var(--product-text)]">总耗时 {formatAiDuration(run.durationMs)}</dd></div>
                <div><dt className="text-xs text-[var(--product-muted)]">模型</dt><dd className="mt-1 break-words text-[var(--product-text)]">{run.model || '不可用'}</dd></div>
              </dl>
              <section aria-labelledby="ai-run-stage-heading">
                <h4 id="ai-run-stage-heading" className="mb-3 text-sm font-semibold text-[var(--product-text)]">阶段耗时</h4>
                <AiRunWaterfall stages={run.stages} />
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

export function AiPerformancePanel() {
  const [data, setData] = useState<AiRunPerformance | null>(null)
  const [task, setTask] = useState('')
  const [rangeDays, setRangeDays] = useState(7)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [taskOptions, setTaskOptions] = useState<string[]>([])
  const [selectedRunId, setSelectedRunId] = useState('')
  const requestSequence = useRef(0)
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null)

  const closeDetails = useCallback(() => {
    setSelectedRunId('')
    requestAnimationFrame(() => detailTriggerRef.current?.focus())
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // axios 依赖可能忽略取消信号，序号仍要阻止慢旧筛选覆盖当前结果。
    const sequence = ++requestSequence.current
    const to = new Date()
    const from = new Date(to.getTime() - rangeDays * dayMs)
    setLoading(true)
    setError(false)
    setData(null)

    void aiRunsAPI.getPerformance({
      from: from.toISOString(),
      to: to.toISOString(),
      task: task || undefined,
      page,
      size: PAGE_SIZE,
    }, controller.signal).then((result) => {
      if (sequence !== requestSequence.current) return
      setData(result)
      setTaskOptions((current) => {
        const next = new Set(current)
        result.byTask.forEach((item) => next.add(item.task))
        return [...next].sort((left, right) => taskLabel(left).localeCompare(taskLabel(right), 'zh-CN'))
      })
    }).catch(() => {
      if (sequence !== requestSequence.current || controller.signal.aborted) return
      setError(true)
    }).finally(() => {
      if (sequence === requestSequence.current && !controller.signal.aborted) setLoading(false)
    })

    return () => controller.abort()
  }, [page, rangeDays, retry, task])

  const taskRows = useMemo(() => data?.byTask || [], [data?.byTask])

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--product-text)]">当前账户概览</h3>
          <p className="mt-1 text-xs text-[var(--product-muted)]">聚合指标不会展示提示词、笔记内容或后端错误详情。</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <label className="grid gap-1 text-xs text-[var(--product-muted)]">
            <span>AI 任务</span>
            <select aria-label="AI 任务" value={task} onChange={(event) => { setTask(event.target.value); setPage(1) }} className="h-10 min-w-0 rounded-lg border border-[var(--product-line-strong)] bg-[var(--product-panel)] px-3 text-sm text-[var(--product-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)] sm:w-40">
              <option value="">全部任务</option>
              {taskOptions.map((option) => <option key={option} value={option}>{taskLabel(option)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--product-muted)]">
            <span>时间范围</span>
            <select aria-label="时间范围" value={rangeDays} onChange={(event) => { setRangeDays(Number(event.target.value)); setPage(1) }} className="h-10 min-w-0 rounded-lg border border-[var(--product-line-strong)] bg-[var(--product-panel)] px-3 text-sm text-[var(--product-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)] sm:w-32">
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天</option>
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex flex-col items-start justify-between gap-3 rounded-lg border border-[var(--product-line)] p-3 text-sm text-[var(--product-text-secondary)] sm:flex-row sm:items-center">
          <span>AI 性能数据加载失败，请重试</span>
          <button type="button" aria-label="重试加载 AI 性能数据" onClick={() => setRetry((value) => value + 1)} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 font-medium text-[var(--product-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)]">
            <RefreshCw className="h-4 w-4" />重试
          </button>
        </div>
      ) : null}

      {loading && !data ? <p role="status" className="py-8 text-center text-sm text-[var(--product-muted)]">正在加载 AI 性能数据…</p> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="AI 性能概览">
            <Metric label="请求数" value={String(data.requestCount)} />
            <Metric label="成功率" value={formatRate(data.successRate)} />
            <Metric label="Fallback 率" value={formatRate(data.fallbackRate)} />
            <Metric label="请求耗时" value={`P50 ${formatAiDuration(data.p50Ms)}`} detail={`P95 ${formatAiDuration(data.p95Ms)}`} />
          </div>

          <section aria-labelledby="ai-task-performance-heading">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--product-muted)]" aria-hidden="true" />
              <h3 id="ai-task-performance-heading" className="text-sm font-semibold text-[var(--product-text)]">任务与阶段</h3>
            </div>
            {taskRows.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--product-line)] p-5 text-sm text-[var(--product-muted)]">当前筛选范围内暂无请求。</p> : (
              <div className="space-y-3">
                {taskRows.map((row) => {
                  const totalP50 = row.stages.reduce((sum, stage) => sum + stage.p50Ms, 0)
                  return (
                    <article key={row.task} className="rounded-lg border border-[var(--product-line)] p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-semibold text-[var(--product-text)]">{taskLabel(row.task)}</h4>
                        <p className="text-xs tabular-nums text-[var(--product-muted)]">{row.requestCount} 次 · P50 {formatAiDuration(row.p50Ms)} · P95 {formatAiDuration(row.p95Ms)}</p>
                      </div>
                      {row.stages.length ? (
                        <>
                          <div className="mt-3 flex h-2 overflow-hidden rounded bg-[var(--product-surface-muted)]" aria-hidden="true">
                            {row.stages.map((stage) => <span key={stage.name} className="h-full border-r border-[var(--product-panel)] bg-[var(--product-accent)] last:border-0" style={{ flexGrow: Math.max(1, stage.p50Ms), flexBasis: totalP50 === 0 ? 'auto' : 0, opacity: Math.max(0.45, Math.min(1, stage.p50Ms / Math.max(...row.stages.map((item) => item.p50Ms)))) }} />)}
                          </div>
                          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                            {row.stages.map((stage) => <div key={stage.name} className="flex items-center justify-between gap-3"><dt className="text-[var(--product-muted)]">{getAiStageLabel(stage.name)}</dt><dd className="tabular-nums text-[var(--product-text)]">P50 {formatAiDuration(stage.p50Ms)}</dd></div>)}
                          </dl>
                        </>
                      ) : <p className="mt-3 text-xs text-[var(--product-muted)]">阶段明细不可用</p>}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="recent-ai-runs-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="recent-ai-runs-heading" className="text-sm font-semibold text-[var(--product-text)]">最近请求</h3>
              <span className="text-xs text-[var(--product-muted)]">共 {data.recentRuns.total} 条</span>
            </div>
            <div className="overflow-x-auto [contain:paint] rounded-lg border border-[var(--product-line)]">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                <thead className="bg-[var(--product-surface-muted)] text-[var(--product-muted)]"><tr><th className="px-3 py-2.5 font-medium">任务</th><th className="px-3 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">耗时</th><th className="px-3 py-2.5 font-medium">Fallback</th><th className="px-3 py-2.5 font-medium">时间</th><th className="px-3 py-2.5 font-medium"><span className="sr-only">操作</span></th></tr></thead>
                <tbody className="divide-y divide-[var(--product-line)]">
                  {data.recentRuns.items.map((run) => (
                    <tr key={run.runId} className="text-[var(--product-text-secondary)]">
                      <td className="px-3 py-3"><span className="font-medium text-[var(--product-text)]">{taskLabel(run.task)}</span>{run.stages.length === 0 ? <span className="ml-2 rounded border border-[var(--product-line)] px-1.5 py-0.5 text-[10px] text-[var(--product-muted)]">旧记录</span> : null}</td>
                      <td className="px-3 py-3">{statusLabels[run.status]}</td>
                      <td className="px-3 py-3 tabular-nums">{formatAiDuration(run.durationMs)}</td>
                      <td className="px-3 py-3">{run.fallbackUsed ? '已使用' : '未使用'}</td>
                      <td className="px-3 py-3 tabular-nums">{run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN') : '不可用'}</td>
                      <td className="px-3 py-3 text-right"><button type="button" aria-label="查看详情" onClick={(event) => { detailTriggerRef.current = event.currentTarget; setSelectedRunId(run.runId) }} className="h-10 rounded-lg px-3 font-medium text-[var(--product-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)]">详情</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.recentRuns.items.length === 0 ? <p className="p-5 text-center text-sm text-[var(--product-muted)]">当前页暂无请求。</p> : null}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" aria-label="上一页" disabled={data.recentRuns.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="grid h-10 w-10 place-items-center rounded-lg border border-[var(--product-line)] text-[var(--product-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)]"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-20 text-center text-xs tabular-nums text-[var(--product-muted)]">第 {data.recentRuns.page} / {Math.max(1, data.recentRuns.totalPages)} 页</span>
              <button type="button" aria-label="下一页" disabled={data.recentRuns.page >= data.recentRuns.totalPages || loading} onClick={() => setPage((current) => current + 1)} className="grid h-10 w-10 place-items-center rounded-lg border border-[var(--product-line)] text-[var(--product-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)]"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </section>
        </>
      ) : null}

      {selectedRunId ? <RunDetails runId={selectedRunId} onClose={closeDetails} /> : null}
    </div>
  )
}
