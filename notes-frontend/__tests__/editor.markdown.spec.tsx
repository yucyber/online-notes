import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'

jest.mock('marked', () => {
  const packageRoot = path.dirname(path.resolve(process.cwd(), 'node_modules', 'marked', 'package.json'))
  const context: Record<string, any> = {}
  vm.runInNewContext(fs.readFileSync(path.join(packageRoot, 'lib', 'marked.umd.js'), 'utf8'), context)
  return { marked: context.marked.marked }
})

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

  it('保留真实 marked 列表中 inline siblings 之间的语义空格', () => {
    const result = normalizeEditorContent('- **foo** *bar*')
    const doc = new DOMParser().parseFromString(result.html, 'text/html')

    expect(result.source).toBe('markdown')
    expect(doc.querySelector('li')?.textContent).toBe('foo bar')
  })

  it('Markdown block 与 inline HTML 混合时仍按 Markdown 转换', () => {
    const result = normalizeEditorContent('# 标题\n<strong>正文</strong>')

    expect(result.source).toBe('markdown')
    expect(result.html).toContain('<h1>标题</h1>')
    expect(result.html).toContain('<strong>正文</strong>')
  })
})
