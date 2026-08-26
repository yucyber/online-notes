import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteChunkerService } from '../src/modules/notes/note-chunker.service'

const markdown = `# 基础

React 使用虚拟 DOM。

## Diff

比较新旧树并生成最小更新。

\`\`\`ts
function diff(previous: Node, next: Node) {
  return previous.key === next.key
}
\`\`\`
`

test('结构化分块保留标题路径和完整 fenced code block', () => {
  const service = new NoteChunkerService()
  const chunks = service.buildChunks({ title: 'React', content: markdown })
  const codeChunk = chunks.find((chunk) => chunk.content.includes('```ts'))

  assert.ok(codeChunk)
  assert.deepEqual(codeChunk.headingPath, ['React', '基础', 'Diff'])
  assert.match(codeChunk.content, /```ts[\s\S]*```/)
})

test('相同笔记输入始终生成相同 Chunk 顺序和哈希', () => {
  const service = new NoteChunkerService()
  const input = { title: 'React', content: markdown }

  assert.deepEqual(service.buildChunks(input), service.buildChunks(input))
})

test('超长普通段落拆分后不超过 900 个估算 token', () => {
  const service = new NoteChunkerService()
  const chunks = service.buildChunks({ title: '长文', content: `## 章节\n\n${'性能优化需要证据。'.repeat(1200)}` })

  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.tokenCount <= 900))
})

test('普通文本跨 Chunk 时保留有限重叠上下文', () => {
  const service = new NoteChunkerService()
  const content = Array.from({ length: 30 }, (_, index) => `段落 ${index}：${'React 性能分析。'.repeat(20)}`).join('\n\n')
  const chunks = service.buildChunks({ title: 'React', content })

  assert.ok(chunks.length > 1)
  const previousTail = chunks[0].content.slice(-20)
  assert.ok(chunks[1].content.includes(previousTail))
})

test('HTML 笔记按小标题建立路径且不会从标签中间切断', () => {
  const service = new NoteChunkerService()
  const longItem = `<p><strong>复杂度</strong>：${'二叉树节点访问。'.repeat(180)}</p>`
  const content = [
    '<h1>二叉树基础</h1>',
    '<pre><code>function walk(node) { return node.left }</code></pre>',
    '<h2>复杂度分析</h2>',
    `<blockquote>${longItem.repeat(8)}</blockquote>`,
  ].join('')

  const chunks = service.buildChunks({ title: '数据结构', content })
  const codeChunk = chunks.find((chunk) => chunk.content.includes('function walk'))
  const analysisChunks = chunks.filter((chunk) => chunk.headingPath.includes('复杂度分析'))

  assert.ok(codeChunk)
  assert.deepEqual(codeChunk.headingPath, ['数据结构', '二叉树基础'])
  assert.ok(analysisChunks.length > 1)
  assert.ok(analysisChunks.every((chunk) => chunk.headingPath.join(' / ') === '数据结构 / 二叉树基础 / 复杂度分析'))
  assert.ok(chunks.every((chunk) => !/^trong>|^\/strong>/.test(chunk.content)))
  assert.ok(chunks.every((chunk) => (chunk.content.match(/<strong>/g) || []).length === (chunk.content.match(/<\/strong>/g) || []).length))
})
