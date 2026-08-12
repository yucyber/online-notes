const mockMarkedParse = jest.fn((raw: string) => {
  const fixtures: Record<string, string> = {
    '# 标题': '<h1>标题</h1>\n',
    '- 条目': '<ul>\n<li>条目</li>\n</ul>\n',
    '> 引用': '<blockquote>\n<p>引用</p>\n</blockquote>\n',
    '[OpenAI](https://openai.com)': '<p><a href="https://openai.com">OpenAI</a></p>\n',
    '| 名称 | 状态 |\n| --- | --- |\n| 编辑器 | 完成 |': '<table><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>编辑器</td><td>完成</td></tr></tbody></table>',
    '```ts\nconst ready = true\n```': '<pre><code class="language-ts">const ready = true\n</code></pre>\n',
  }
  return fixtures[raw] || `<p>${raw}</p>\n`
})

jest.mock('marked', () => ({ marked: { parse: mockMarkedParse } }))

import {
  getMarkdownPasteHTML,
  normalizeEditorContent,
} from '@/components/editor/useTiptapEditorBridge'

describe('统一编辑器内容兼容', () => {
  it.each([
    ['# 标题', '<h1>标题</h1>'],
    ['- 条目', '<ul><li><p>条目</p></li></ul>'],
    ['> 引用', '<blockquote><p>引用</p></blockquote>'],
  ])('将明确 Markdown 转成 Tiptap 可读 HTML：%s', (raw, fragment) => {
    const result = normalizeEditorContent(raw)

    expect(result.source).toBe('markdown')
    expect(result.html).toContain(fragment)
    expect(result.preservedRaw).toBeUndefined()
  })

  it('原样传递已有 HTML', () => {
    const raw = '<h2 data-source="legacy">旧内容</h2>'

    expect(normalizeEditorContent(raw)).toEqual({ html: raw, source: 'html' })
  })

  it('原样传递旧资源卡片自定义 HTML', () => {
    const raw = '<resource-embed type="mindmap" id="map-1"></resource-embed>'

    expect(normalizeEditorContent(raw)).toEqual({ html: raw, source: 'html' })
  })

  it('将普通文本转义后包为段落并保留换行', () => {
    expect(normalizeEditorContent('2 < 3 & 4 > 1\n下一行')).toEqual({
      html: '<p>2 &lt; 3 &amp; 4 &gt; 1<br>下一行</p>',
      source: 'plain',
    })
  })

  it('Markdown 转换失败时保留经过转义的原始文本', () => {
    mockMarkedParse.mockImplementationOnce(() => {
      throw new Error('conversion failed')
    })
    const raw = '# 标题 <broken>'

    expect(normalizeEditorContent(raw)).toEqual({
      html: '<p># 标题 &lt;broken&gt;</p>',
      source: 'markdown',
      preservedRaw: raw,
    })
  })
})

describe('Markdown 粘贴识别', () => {
  it.each([
    ['[OpenAI](https://openai.com)', '<a href="https://openai.com">OpenAI</a>'],
    ['| 名称 | 状态 |\n| --- | --- |\n| 编辑器 | 完成 |', '<table>'],
    ['```ts\nconst ready = true\n```', '<pre><code class="language-ts">'],
  ])('仅转换具有明确结构的纯文本：%s', (plainText, fragment) => {
    expect(getMarkdownPasteHTML(plainText, '')).toContain(fragment)
  })

  it('普通文本沿用 Tiptap 原生粘贴', () => {
    expect(getMarkdownPasteHTML('这是一段普通文本。', '')).toBeNull()
  })

  it('HTML 剪贴板内容沿用 Tiptap 原生粘贴', () => {
    expect(getMarkdownPasteHTML('# 标题', '<h1>标题</h1>')).toBeNull()
  })
})
