import { useEffect, useRef } from 'react'

export type NormalizedEditorContent = {
  html: string
  source: 'html' | 'markdown' | 'plain'
  preservedRaw?: string
}

const HTML_ELEMENT_PATTERN = /<(?:!--[\s\S]*?--|\/?(?:html|head|body|p|div|span|h[1-6]|ul|ol|li|blockquote|pre|code|table|thead|tbody|tfoot|tr|th|td|a|img|br|hr|strong|em|b|i|s|u|resource-embed)(?:\s[^<>]*|\s*\/?)>)/i
const MARKDOWN_BLOCK_PATTERN = /^\s{0,3}(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>\s?|```|~~~)/m
const MARKDOWN_LINK_PATTERN = /!?\[[^\]\n]+\]\([^\n)]+\)/
const MARKDOWN_EMPHASIS_PATTERN = /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~)/
const MARKDOWN_TABLE_PATTERN = /^\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}:?\s*\|/m

function escapePlainText(raw: string) {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function plainTextToHTML(raw: string) {
  if (!raw) return '<p></p>'
  return `<p>${escapePlainText(raw).replace(/\r?\n/g, '<br>')}</p>`
}

function isExplicitMarkdown(raw: string) {
  return MARKDOWN_BLOCK_PATTERN.test(raw)
    || MARKDOWN_LINK_PATTERN.test(raw)
    || MARKDOWN_EMPHASIS_PATTERN.test(raw)
    || MARKDOWN_TABLE_PATTERN.test(raw)
}

function normalizeMarkedHTML(html: string) {
  if (typeof document === 'undefined') return html.trim()

  const template = document.createElement('template')
  template.innerHTML = html

  // marked 的紧凑列表没有段落节点；补齐 Tiptap schema 所需结构，避免首次保存时内容漂移。
  template.content.querySelectorAll('li').forEach((item) => {
    let paragraph: HTMLParagraphElement | null = null
    Array.from(item.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
        node.remove()
        return
      }
      const isBlock = node instanceof HTMLElement && /^(P|UL|OL|BLOCKQUOTE|PRE|TABLE|DIV)$/.test(node.tagName)
      if (isBlock) {
        paragraph = null
        return
      }
      if (!paragraph) {
        paragraph = document.createElement('p')
        item.insertBefore(paragraph, node)
      }
      paragraph.appendChild(node)
    })
  })

  template.content.querySelectorAll('ul, ol, blockquote, table, thead, tbody, tfoot, tr').forEach((container) => {
    Array.from(container.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) node.remove()
    })
  })
  Array.from(template.content.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) node.remove()
  })

  return template.innerHTML.trim()
}

export function normalizeEditorContent(raw: string): NormalizedEditorContent {
  const original = String(raw || '')
  if (HTML_ELEMENT_PATTERN.test(original)) return { html: original, source: 'html' }
  if (!isExplicitMarkdown(original)) return { html: plainTextToHTML(original), source: 'plain' }

  try {
    // marked@17 为 ESM-only，仅在确认需要转换时加载，HTML/plain 路径不会被转换器故障牵连。
    const { marked } = require('marked') as { marked: { parse: (source: string, options: { async: false }) => string | Promise<string> } }
    const converted = marked.parse(original, { async: false })
    if (typeof converted !== 'string') throw new Error('marked returned async content')
    return { html: normalizeMarkedHTML(converted), source: 'markdown' }
  } catch {
    // 转换失败时绝不能把疑似标签重新解释为 HTML，否则旧内容可能在编辑器中丢失。
    return { html: plainTextToHTML(original), source: 'markdown', preservedRaw: original }
  }
}

export function normalizeMarkdownPaste(plainText: string, clipboardHTML: string): NormalizedEditorContent | null {
  if (clipboardHTML.trim()) return null
  const normalized = normalizeEditorContent(plainText)
  return normalized.source === 'markdown' ? normalized : null
}

export function getMarkdownPasteHTML(plainText: string, clipboardHTML: string) {
  return normalizeMarkdownPaste(plainText, clipboardHTML)?.html ?? null
}

type Props = {
  onSelectionChange?: (start: number, end: number) => void
  onContentChange?: (html: string) => void
  onSave: (html: string) => Promise<void>
}

export function useTiptapEditorBridge({ onSelectionChange, onContentChange, onSave }: Props) {
  // useEditor 的事件处理器只在初次挂载时创建，用 ref 避免闭包捕获旧回调。
  const onSelectionChangeRef = useRef<typeof onSelectionChange | null>(onSelectionChange)
  const onContentChangeRef = useRef<typeof onContentChange | null>(onContentChange)
  const onSaveRef = useRef<typeof onSave | null>(onSave)

  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
  useEffect(() => { onContentChangeRef.current = onContentChange }, [onContentChange])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  return { onSelectionChangeRef, onContentChangeRef, onSaveRef }
}
