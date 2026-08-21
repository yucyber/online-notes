'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type SelectOption = { value: string; label: string }

type Props = {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

// 轻量自定义下拉，替代原生 <select>，使展开后的选项悬停高亮可用 CSS 完全控制。
export function Select({ id, value, options, onChange, disabled = false, placeholder = '请选择' }: Props) {
  const generatedId = useId()
  const listboxId = `${id || generatedId}-listbox`
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  // 打开时默认高亮当前 selected 项，更符合用户预期（按 Enter 保留当前选择）。
  useEffect(() => {
    if (!open) {
      setHighlighted(-1)
      return
    }
    const idx = options.findIndex((o) => o.value === value)
    setHighlighted(idx >= 0 ? idx : 0)
  }, [open, options, value])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setHighlighted((h) => {
          const start = h < 0 ? 0 : h
          return (start + dir + options.length) % options.length
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (highlighted >= 0 && highlighted < options.length) {
          onChange(options[highlighted].value)
          setOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, highlighted, options, onChange])

  useEffect(() => {
    if (open && highlighted >= 0 && listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlighted])

  return (
    <div ref={rootRef} className="ui-select">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="ui-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`ui-select__value${selected ? '' : ' ui-select__placeholder'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown aria-hidden="true" className={`ui-select__caret${open ? ' ui-select__caret--open' : ''}`} />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="ui-select__menu"
          tabIndex={-1}
          aria-activedescendant={highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value
            const isHighlighted = i === highlighted
            return (
              <li
                id={`${listboxId}-option-${i}`}
                key={o.value || '__empty__'}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                className={`ui-select__option${isSelected ? ' ui-select__option--selected' : ''}${isHighlighted ? ' ui-select__option--highlighted' : ''}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => { onChange(o.value); setOpen(false) }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="ui-select__option-label">{o.label}</span>
                {isSelected && <Check aria-hidden="true" className="ui-select__check" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
