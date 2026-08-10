import type { Category } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, BarChart3, Layers } from 'lucide-react'

type Stats = {
  total: number
  active: number
  idle: number
  idlePreview: Category[]
  stalePreview: Array<{ category: Category; days: number }>
  colorUsage: Array<[string, number]>
}

export function CategoryOverviewPanel({ stats }: { stats: Stats }) {
  return (
    <Card className="shadow-md" style={{ borderColor: 'var(--border)' }}>
      <CardHeader className="flex flex-row items-center justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
        <div><CardTitle className="text-xl font-bold" style={{ color: 'var(--on-surface)' }}>{"分类健康度"}</CardTitle><CardDescription className="mt-1">{"快速识别闲置分类、推荐合并与颜色治理建议"}</CardDescription></div>
        <BarChart3 className="h-6 w-6 text-primary" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label={"分类健康度"} value={stats.total} hint={`${stats.active} 个正在被引用`} />
          <Stat label={"快速识别闲置分类、推荐合并与颜色治理建议"} value={stats.active} hint={"闲置提醒"} />
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            <p className="flex items-center gap-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}><AlertTriangle className="h-3.5 w-3.5" />{"闲置提醒"}</p>
            <p className="mt-2 text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>{stats.idle}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{"考虑合并或删除冗余分类"}</p>
          </div>
        </div>
        {stats.idle > 0 && <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}><p className="font-medium">{"闲置分类建议合并/清理"}</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{stats.idlePreview.map((category) => category.name).join('、 ') || '暂无待处理'}</p></div>}
        {stats.stalePreview.length > 0 && <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--on-surface)' }}><p className="font-medium">{"长期未更新的分类"}</p><ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>{stats.stalePreview.map(({ category, days }) => <li key={category.id} className="flex items-center gap-2"><Layers className="h-3.5 w-3.5" /><span>{category.name}</span><span>已闲置 {days} 天</span></li>)}</ul></div>}
        {stats.colorUsage.length > 0 && <div><p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{"颜色使用情况"}</p><div className="mt-3 flex flex-wrap gap-3">{stats.colorUsage.map(([color, count]) => <div key={color} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}><span className="h-3 w-3 rounded-full shadow-inner" style={{ backgroundColor: color }} />{color.toUpperCase()} · {count}</div>)}</div></div>}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}><p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p><p className="mt-2 text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>{value}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p></div>
}
