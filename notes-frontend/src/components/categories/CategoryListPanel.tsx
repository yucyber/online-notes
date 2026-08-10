import type { Category } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/utils'
import { Pencil, RefreshCcw, Trash2 } from 'lucide-react'
import { DEFAULT_CATEGORY_COLOR } from './categories-page-utils'

type Props = {
  categories: Category[]
  loading: boolean
  selectedCategoryIds: string[]
  batchColor: string
  batchParentId: string
  batchProcessing: boolean
  allSelected: boolean
  parentLookup: Record<string, Category>
  onSetBatchColor: (value: string) => void
  onSetBatchParentId: (value: string) => void
  onSelectAll: () => void
  onRefresh: () => void
  onToggleSelection: (id: string) => void
  onBatchColorUpdate: () => void
  onBatchParentUpdate: () => void
  onBatchDelete: () => void
  onEdit: (category: Category) => void
  onDelete: (id: string) => void
}

export function CategoryListPanel(props: Props) {
  const { categories, loading, selectedCategoryIds, batchColor, batchParentId, batchProcessing, allSelected, parentLookup } = props
  return (
    <Card className="bg-white shadow-md border-gray-200">
      <CardHeader className="flex flex-row items-center justify-between border-b border-gray-100 pb-4">
        <div><CardTitle className="text-xl font-bold text-gray-900">{"分类列表"}</CardTitle><CardDescription className="mt-1">共 {categories.length} 条分类</CardDescription></div>
        <div className="flex items-center gap-3">
          {categories.length > 0 && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={allSelected} onChange={props.onSelectAll} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />{"全选"}</label>}
          <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={loading} className="shadow-sm"><RefreshCcw className="mr-2 h-4 w-4" />{"刷新"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedCategoryIds.length > 0 && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-gray-700 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><p className="font-medium">已选中 {selectedCategoryIds.length} 个分类，可批量整理</p><div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 text-xs"><span>{"颜色"}</span><input type="color" value={batchColor} onChange={(event) => props.onSetBatchColor(event.target.value)} className="h-8 w-16 cursor-pointer rounded border border-gray-200 bg-white p-1" /><Button size="sm" variant="secondary" disabled={batchProcessing} onClick={props.onBatchColorUpdate}>{"同步颜色"}</Button></div><div className="flex items-center gap-2 text-xs"><span>{"父级"}</span><select value={batchParentId} onChange={(event) => props.onSetBatchParentId(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs focus:border-primary focus:outline-none" disabled={batchProcessing}><option value="">{"清空父级"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><Button size="sm" variant="secondary" disabled={batchProcessing} onClick={props.onBatchParentUpdate}>{"调整层级"}</Button></div><Button size="sm" variant="destructive" disabled={batchProcessing} onClick={props.onBatchDelete}>{"批量删除"}</Button></div></div></div>}
        {loading ? <div className="flex items-center justify-center py-10 text-gray-500">{"正在加载分类..."}</div> : categories.length === 0 ? <div className="text-center py-10 text-gray-500">{"暂无分类，请在左侧创建您的第一个分类"}</div> : categories.map((category) => <CategoryRow key={category.id} category={category} selected={selectedCategoryIds.includes(category.id)} parentName={category.parentId ? parentLookup[category.parentId]?.name : undefined} onToggle={() => props.onToggleSelection(category.id)} onEdit={() => props.onEdit(category)} onDelete={() => props.onDelete(category.id)} />)}
      </CardContent>
    </Card>
  )
}

function CategoryRow({ category, selected, parentName, onToggle, onEdit, onDelete }: { category: Category; selected: boolean; parentName?: string; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className="group flex flex-col gap-4 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 md:flex-row md:items-center md:justify-between hover:border-primary-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ease-out cursor-pointer"><div className="flex flex-1 items-start gap-4"><input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" /><div className="mt-1 h-5 w-5 rounded-full shadow-md ring-2 ring-white" style={{ backgroundColor: category.color || DEFAULT_CATEGORY_COLOR }} /><div className="flex-1"><div className="flex items-center gap-3 mb-2"><p className="text-lg font-bold text-gray-900">{category.name}</p><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 shadow-sm">{category.noteCount ?? 0} 条笔记</span></div>{category.description && <p className="mt-2 text-sm text-gray-600 leading-relaxed">{category.description}</p>}{parentName && <p className="mt-2 text-xs text-primary-700">隶属于：{parentName}</p>}<p className="mt-3 text-xs text-gray-500">更新于 {formatDate(category.updatedAt)}</p></div></div><div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={onEdit} className="hover:bg-primary-50 hover:text-primary-700 transition-all duration-200"><Pencil className="mr-1 h-4 w-4" />{"编辑"}</Button><Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 transition-all duration-200" onClick={onDelete}><Trash2 className="mr-1 h-4 w-4" />{"删除"}</Button></div></div>
}
