const mockMarkedParse = jest.fn((raw: string) => {
  const fixtures: Record<string, string> = {
    '**粗体**': '<p><strong>粗体</strong></p>\n',
    '1. 第一项\n2. 第二项': '<ol><li>第一项</li><li>第二项</li></ol>\n',
    '[旧链接](https://example.com)': '<p><a href="https://example.com">旧链接</a></p>\n',
  }
  return fixtures[raw] || `<p>${raw}</p>\n`
})

jest.mock('marked', () => ({ marked: { parse: mockMarkedParse } }))

import { normalizeEditorContent } from '@/components/editor/useTiptapEditorBridge'

describe('旧 Markdown 内容兼容', () => {
  it.each([
    ['**粗体**', '<strong>粗体</strong>'],
    ['1. 第一项\n2. 第二项', '<ol>'],
    ['[旧链接](https://example.com)', '<a href="https://example.com">旧链接</a>'],
  ])('统一转为后端仍可保存的 HTML：%s', (raw, fragment) => {
    const result = normalizeEditorContent(raw)

    expect(result.source).toBe('markdown')
    expect(result.html).toContain(fragment)
  })
})
