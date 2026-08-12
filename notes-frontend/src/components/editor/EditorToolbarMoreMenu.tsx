'use client'

import { useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  disabled?: boolean
  exec: (cmd: string, payload?: unknown) => void
}

const actions = [
  ['左对齐', 'align', { align: 'left' }],
  ['居中', 'align', { align: 'center' }],
  ['右对齐', 'align', { align: 'right' }],
  ['高亮', 'highlight'],
  ['上标', 'sup'],
  ['下标', 'sub'],
  ['插入分隔线', 'hr'],
] as const

export function EditorToolbarMoreMenu({ disabled, exec }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeAndRestoreFocus = () => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div className="editor-toolbar-more">
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        aria-label="更多格式"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {open && (
        <div role="menu" aria-label="更多格式" className="editor-toolbar-more__menu" onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          closeAndRestoreFocus()
        }}>
          {actions.map(([label, command, payload]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                exec(command, payload)
                closeAndRestoreFocus()
              }}
            >{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
