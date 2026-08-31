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
        <li key={`${stage.name}-${stage.attempt ?? 0}-${index}`} className="grid gap-1.5 sm:grid-cols-[110px_minmax(0,1fr)_80px] sm:items-center">
          <span className="text-xs font-medium text-[var(--product-text-secondary)]">{getAiStageLabel(stage.name)}</span>
          <span className="h-2 overflow-hidden rounded bg-[var(--product-surface-muted)]" aria-hidden="true">
            <span
              className="block h-full rounded bg-[var(--product-accent)]"
              style={{ width: `${maxDuration === 0 ? 0 : Math.max(3, (stage.durationMs / maxDuration) * 100)}%` }}
            />
          </span>
          <span className="text-left text-xs tabular-nums text-[var(--product-text)] sm:text-right">
            {formatAiDuration(stage.durationMs)}
          </span>
        </li>
      ))}
    </ol>
  )
}
