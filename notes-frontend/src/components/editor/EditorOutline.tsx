import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import type { EditorHeading } from './editor-outline-utils'

type Props = {
  headings: EditorHeading[]
  pinned: boolean
  onPinnedChange: (pinned: boolean) => void
}

export function EditorOutline({ headings, pinned, onPinnedChange }: Props) {
  return (
    <aside className="editor-outline" data-pinned={pinned} aria-label="大纲">
      <div className="editor-outline__pin">
        <span className="editor-outline__pin-text">大纲</span>
        <button
          type="button"
          className="editor-outline__hide"
          aria-label={pinned ? '收起大纲' : '展开大纲'}
          onClick={(event) => {
            event.currentTarget.blur()
            onPinnedChange(!pinned)
          }}
        >
          <PrototypeGlyph name={pinned ? 'eye-off' : 'eye'} className="w-4 h-4" />
        </button>
      </div>
      <div className="editor-outline__view">
        <div className="editor-outline__list">
          {headings.length === 0 ? <span className="editor-outline__empty">暂无标题</span> : headings.map((heading, index) => (
            <div key={heading.id} className="editor-outline__item" data-depth={heading.level}>
              <button type="button" className="editor-outline__link" onClick={() => document.dispatchEvent(new CustomEvent('editor:scrollToHeading', { detail: { index } }))}>{heading.text}</button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
