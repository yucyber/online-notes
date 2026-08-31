import type { AiRunStage } from '@/lib/api/ai-runs'

const stageLabels: Record<string, string> = {
  request: '请求总计',
  context_prepare: '准备数据',
  capacity_wait: '等待容量',
  provider: '模型调用',
  validation: '结果校验',
  persistence: '保存结果',
  response: '返回响应',
}

type StageModelInfo = {
  model: string
  isFallback: boolean
  fallbackLabel: string
  attempt: number
}

// 只有模型调用（或带 model 信息）的阶段才需要标注模型与首次/降级。
function stageModelInfo(stage: AiRunStage): StageModelInfo | null {
  const model = stage.model?.trim() || stage.provider?.trim() || ''
  if (!model) return null
  const attempt = stage.attempt ?? 1
  const isFallback = Boolean(stage.fallbackType) || attempt > 1
  const fallbackLabel = stage.fallbackType === 'quality' ? '质量' : stage.fallbackType === 'provider' ? '供应商' : ''
  return { model, isFallback, fallbackLabel, attempt }
}

export function formatAiDuration(durationMs?: number) {
  if (durationMs === undefined) return '不可用'
  if (durationMs < 1000) return `${durationMs} 毫秒`
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(durationMs / 1000)} 秒`
}

export function getAiStageLabel(name: string) {
  return stageLabels[name] || name
}

export function AiRunWaterfall({ stages }: { stages: AiRunStage[] }) {
  const maxDuration = stages.reduce((maximum, stage) => Math.max(maximum, stage.durationMs), 0)

  if (stages.length === 0) {
    return <p className="text-sm text-[var(--product-muted)]">阶段明细不可用</p>
  }

  return (
    <ol className="space-y-3" aria-label="AI 请求阶段耗时">
      {stages.map((stage, index) => (
        <li key={`${stage.name}-${stage.attempt ?? 0}-${index}`} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_80px] sm:items-center">
          <div className="min-w-0">
            <span className="text-xs font-medium text-[var(--product-text-secondary)]">{getAiStageLabel(stage.name)}</span>
            {(() => {
              const info = stageModelInfo(stage)
              if (!info) return null
              return (
                <span className="mt-0.5 flex flex-wrap items-center gap-1">
                  <span className="truncate text-[10px] text-[var(--product-muted)]" title={info.model}>{info.model}</span>
                  <span
                    className={
                      info.isFallback
                        ? 'rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[9px] text-amber-700'
                        : 'rounded border border-[var(--product-line)] px-1 py-px text-[9px] text-[var(--product-text-secondary)]'
                    }
                  >
                    {info.isFallback ? `第 ${info.attempt} 次 · 降级${info.fallbackLabel ? `·${info.fallbackLabel}` : ''}` : '首次调用'}
                  </span>
                </span>
              )
            })()}
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 flex-1 overflow-hidden rounded bg-[var(--product-surface-muted)]" aria-hidden="true">
              <span
                className="block h-full rounded bg-[var(--product-accent)]"
                style={{ width: `${maxDuration === 0 ? 0 : Math.max(3, (stage.durationMs / maxDuration) * 100)}%` }}
              />
            </span>
          </div>
          <span className="text-left text-xs tabular-nums text-[var(--product-text)] sm:text-right">
            {formatAiDuration(stage.durationMs)}
          </span>
        </li>
      ))}
    </ol>
  )
}
