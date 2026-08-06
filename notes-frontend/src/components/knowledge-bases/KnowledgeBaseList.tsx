'use client'

import { FormEvent } from 'react'
import { BookOpenCheck, Loader2, PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { KnowledgeBase } from '@/types'

type FormState = { name: string; description: string }

export function KnowledgeBaseList(props: {
  knowledgeBases: KnowledgeBase[]
  selectedId: string
  formState: FormState
  saving: boolean
  onSelect: (id: string) => void
  onFormChange: (updater: (prev: FormState) => FormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  const { knowledgeBases, selectedId, formState, saving, onSelect, onFormChange, onSubmit } = props

  return (
    <div className="space-y-6">
      <Card style={{ borderColor: 'var(--border)' }}>
        <CardHeader>
          <CardTitle className="text-xl">创建知识库</CardTitle>
          <CardDescription>名称描述知识边界，描述记录纳入规则。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <Input
              value={formState.name}
              onChange={(event) => onFormChange((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="知识库名称"
              maxLength={80}
            />
            <Textarea
              value={formState.description}
              onChange={(event) => onFormChange((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="描述这个知识库的边界"
              maxLength={500}
              style={{ minHeight: '92px' }}
            />
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              创建知识库
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card style={{ borderColor: 'var(--border)' }}>
        <CardHeader>
          <CardTitle className="text-xl">全部知识库</CardTitle>
          <CardDescription>{knowledgeBases.length} 个边界集合</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {knowledgeBases.length === 0 ? (
            <div className="rounded-xl border border-dashed p-5 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              还没有知识库。先创建一个，再从笔记列表加入内容。
            </div>
          ) : (
            knowledgeBases.map((item) => {
              const selected = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="w-full rounded-xl border p-3 text-left transition"
                  style={{
                    borderColor: selected ? 'var(--primary-600)' : 'var(--border)',
                    background: selected ? 'var(--primary-50)' : 'var(--surface-1)',
                    color: 'var(--on-surface)',
                  }}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <BookOpenCheck className="h-4 w-4" />
                    {item.name}
                  </span>
                  {item.description && (
                    <span className="mt-1 block text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                      {item.description}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
