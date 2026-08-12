import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Category, Tag } from '@/types'

type Props = {
  categories: Category[]
  tags: Tag[]
  selectedCategory: string
  selectedTags: string[]
  auxCategoryIds: string[]
  tagInput: string
  expandedCats: Record<string, boolean>
  metaLoading: boolean
  metaError: string
  readOnly: boolean
  resolveCategoryId: (category: Category) => string
  setSelectedCategory: (value: string) => void
  setSelectedTags: (value: string[]) => void
  setAuxCategoryIds: (value: string[]) => void
  setTagInput: (value: string) => void
  setExpandedCats: Dispatch<SetStateAction<Record<string, boolean>>>
  toggleTag: (id: string) => void
  addTagsByNames: (names: string[]) => unknown | Promise<unknown>
  rejectReadOnlyWrite: () => boolean
}

export function EditorNoteProperties({
  categories,
  tags,
  selectedCategory,
  selectedTags,
  auxCategoryIds,
  tagInput,
  expandedCats,
  metaLoading,
  metaError,
  readOnly,
  resolveCategoryId,
  setSelectedCategory,
  setSelectedTags,
  setAuxCategoryIds,
  setTagInput,
  setExpandedCats,
  toggleTag,
  addTagsByNames,
  rejectReadOnlyWrite,
}: Props) {
  const childrenByParent = categories.reduce<Record<string, Category[]>>((groups, category) => {
    const key = category.parentId || '__root__'
    ;(groups[key] ||= []).push(category)
    return groups
  }, {})

  const renderCategory = (category: Category, level = 0): React.ReactNode => {
    const id = resolveCategoryId(category)
    const children = childrenByParent[id] || []
    const expanded = Boolean(expandedCats[id])
    const checked = auxCategoryIds.includes(id)

    return (
      <div key={id || category.name}>
        <div className="editor-properties__category" style={{ paddingLeft: `${level * 14}px` }}>
          {children.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={expanded ? `折叠${category.name}` : `展开${category.name}`}
              onClick={() => setExpandedCats((current) => ({ ...current, [id]: !current[id] }))}
            >
              {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
            </Button>
          ) : <span className="editor-properties__category-spacer" aria-hidden />}
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={readOnly || !id}
              onChange={(event) => {
                if (rejectReadOnlyWrite()) return
                setAuxCategoryIds(event.target.checked
                  ? Array.from(new Set([...auxCategoryIds, id]))
                  : auxCategoryIds.filter((value) => value !== id))
              }}
            />
            <span>{category.name}</span>
          </label>
        </div>
        {expanded && children.map((child) => renderCategory(child, level + 1))}
      </div>
    )
  }

  const commitTagInput = () => {
    if (rejectReadOnlyWrite()) return
    const names = tagInput.split(/[,\s]+/).filter(Boolean)
    if (names.length === 0) return
    setTagInput('')
    void addTagsByNames(names)
  }

  return (
    <div className="editor-properties">
      <section className="editor-properties__section">
        <div className="editor-properties__label-row">
          <label htmlFor="editor-category">选择分类</label>
          {metaLoading && <span>加载中...</span>}
        </div>
        <select
          id="editor-category"
          value={selectedCategory}
          disabled={readOnly || metaLoading || Boolean(metaError)}
          onChange={(event) => {
            if (rejectReadOnlyWrite()) return
            setSelectedCategory(event.target.value)
          }}
        >
          <option value="">未分类</option>
          {categories.map((category) => {
            const value = resolveCategoryId(category)
            return <option key={value || category.name} value={value}>{category.name}</option>
          })}
        </select>
      </section>

      <section className="editor-properties__section">
        <h3>附属分类</h3>
        <div className="editor-properties__tree">
          {(childrenByParent.__root__ || []).map((category) => renderCategory(category))}
          {!metaLoading && categories.length === 0 && <p>暂无分类</p>}
        </div>
      </section>

      <section className="editor-properties__section">
        <div className="editor-properties__label-row">
          <label htmlFor="editor-tag-input">标签</label>
          {metaLoading && <span>加载中...</span>}
        </div>
        <div className="editor-properties__tag-input">
          <input
            id="editor-tag-input"
            type="text"
            value={tagInput}
            disabled={readOnly}
            placeholder="输入标签后按 Enter"
            onChange={(event) => {
              if (rejectReadOnlyWrite()) return
              setTagInput(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commitTagInput()
            }}
          />
          <Button type="button" variant="outline" disabled={readOnly || selectedTags.length === 0} onClick={() => {
            if (rejectReadOnlyWrite()) return
            setSelectedTags([])
          }}>清空</Button>
        </div>
        {tagInput && (
          <Button type="button" variant="ghost" className="editor-properties__create-tag" onClick={commitTagInput}>
            创建标签“{tagInput}”
          </Button>
        )}
        <div className="editor-properties__tags">
          {tags.map((tag) => {
            const id = tag.id || (tag as Tag & { _id?: string })._id || ''
            const active = selectedTags.includes(id)
            return (
              <Button
                key={id || tag.name}
                type="button"
                variant={active ? 'default' : 'outline'}
                disabled={readOnly || !id}
                aria-pressed={active}
                onClick={() => id && toggleTag(id)}
              >{tag.name}</Button>
            )
          })}
          {!metaLoading && tags.length === 0 && <p>{metaError || '暂无可用标签'}</p>}
        </div>
      </section>
    </div>
  )
}
