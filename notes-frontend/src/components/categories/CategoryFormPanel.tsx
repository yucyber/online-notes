'use client'

import type { FormEvent } from 'react'
import type { Category } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PlusCircle, Sparkles, X } from 'lucide-react'
import type { CategoryTemplate } from './categories-page-utils'

type Props = {
  categories: Category[]
  editingId: string | null
  formState: { name: string; description: string; color: string; parentId: string }
  saving: boolean
  progressMeta: { percent: number; message: string }
  templateCandidates: CategoryTemplate[]
  onSubmit: (event: FormEvent) => void
  onChange: (field: 'name' | 'description' | 'color' | 'parentId', value: string) => void
  onReset: () => void
  onApplyTemplate: (template: CategoryTemplate) => void
}

export function CategoryFormPanel({
  categories,
  editingId,
  formState,
  saving,
  progressMeta,
  templateCandidates,
  onSubmit,
  onChange,
  onReset,
  onApplyTemplate,
}: Props) {
  return (
    <Card className="shadow-md" style={{ borderColor: 'var(--border)' }}>
      <CardHeader className="border-b pb-4" style={{ borderColor: 'var(--border)' }}>
        <CardTitle className="text-xl font-bold" style={{ color: 'var(--on-surface)' }}>{editingId ? '编辑分类' : '新建分类'}</CardTitle>
        <CardDescription className="mt-2 text-base">{'用颜色和描述区分知识领域'}</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div>
          <div className="flex items-center justify-between text-sm" style={{ color: 'var(--on-surface)' }}>
            <span>{'分类覆盖'}</span><span>{progressMeta.percent}%</span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full" style={{ background: 'var(--surface-2)' }}>
            <div className="h-2 rounded-full transition-all" style={{ width: `${progressMeta.percent}%`, background: 'var(--primary-600)' }} />
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{progressMeta.message}</p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>{'分类名称'}</label>
            <Input placeholder={'例如：项目管理、技术沉淀'} value={formState.name} disabled={saving} onChange={(event) => onChange('name', event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>{'描述'}</label>
            <Textarea placeholder={'补充说明分类用途，方便团队理解和协作'} rows={3} value={formState.description} disabled={saving} onChange={(event) => onChange('description', event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>{'颜色'}</label>
            <div className="flex items-center gap-3">
              <input type="color" value={formState.color} disabled={saving} onChange={(event) => onChange('color', event.target.value)} className="h-10 w-20 cursor-pointer rounded border p-1" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }} />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{formState.color}</span>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>{'父分类'}</label>
            <select value={formState.parentId} disabled={saving} onChange={(event) => onChange('parentId', event.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
              <option value="">{'无（顶级分类）'}</option>
              {categories.map((category) => <option key={category.id} value={category.id} disabled={editingId === category.id}>{category.name}</option>)}
            </select>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{'子分类继承父分类的可见范围'}</p>
          </div>
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
            <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4" />{'快速模板'}</div>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{'一键应用预设分类'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {templateCandidates.map((template) => <button key={`${template.name}-${template.color}`} type="button" onClick={() => onApplyTemplate(template)} className="group rounded-full border px-3 py-1 text-xs font-medium transition" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
                {template.name}<span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{'应用'}</span>
              </button>)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="flex-1"><PlusCircle className="mr-2 h-4 w-4" />{editingId ? '保存修改' : '创建分类'}</Button>
            {editingId && <Button type="button" variant="outline" disabled={saving} onClick={onReset}><X className="mr-2 h-4 w-4" />{'取消编辑'}</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
