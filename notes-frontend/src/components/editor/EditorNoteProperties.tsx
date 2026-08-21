import { Button } from '@/components/ui/button'
import { TagChip } from '@/components/ui/tag-chip'
import type { Category, Tag } from '@/types'

type Props = {
  categories: Category[]
  tags: Tag[]
  selectedCategory: string
  selectedTags: string[]
  tagInput: string
  metaLoading: boolean
  metaError: string
  readOnly: boolean
  resolveCategoryId: (category: Category) => string
  setSelectedCategory: (value: string) => void
  setSelectedTags: (value: string[]) => void
  setTagInput: (value: string) => void
  toggleTag: (id: string) => void
  addTagsByNames: (names: string[]) => unknown | Promise<unknown>
  rejectReadOnlyWrite: () => boolean
}

export function EditorNoteProperties({
  categories,
  tags,
  selectedCategory,
  selectedTags,
  tagInput,
  metaLoading,
  metaError,
  readOnly,
  resolveCategoryId,
  setSelectedCategory,
  setSelectedTags,
  setTagInput,
  toggleTag,
  addTagsByNames,
  rejectReadOnlyWrite,
}: Props) {
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
          {metaLoading && <span className="editor-properties__hint">加载中...</span>}
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
        <div className="editor-properties__label-row">
          <label htmlFor="editor-tag-input">标签</label>
          {metaLoading && <span className="editor-properties__hint">加载中...</span>}
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
          <Button type="button" variant="ghost" disabled={readOnly || selectedTags.length === 0} onClick={() => {
            if (rejectReadOnlyWrite()) return
            setSelectedTags([])
          }}>清空</Button>
        </div>
        {tagInput && (
          <Button type="button" variant="link" className="editor-properties__create-tag" onClick={commitTagInput}>
            创建标签“{tagInput}”
          </Button>
        )}
        <div className="editor-properties__tags">
          {tags.map((tag) => {
            const id = tag.id || (tag as Tag & { _id?: string })._id || ''
            const active = selectedTags.includes(id)
            return (
              <TagChip
                key={id || tag.name}
                active={active}
                disabled={readOnly || !id}
                onClick={() => id && toggleTag(id)}
              >{tag.name}</TagChip>
            )
          })}
          {!metaLoading && tags.length === 0 && <p>{metaError || '暂无可用标签'}</p>}
        </div>
      </section>
    </div>
  )
}
