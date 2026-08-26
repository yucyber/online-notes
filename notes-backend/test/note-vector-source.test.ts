import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteVectorSourceService } from '../src/modules/notes/note-vector-source.service'

test('主题向量文本使用最终摘要和分类标签名称，并按固定顺序输出', () => {
  const service = new NoteVectorSourceService()

  const source = service.buildTopicVectorSource({
    title: ' React Diff ',
    summary: '比较新旧虚拟 DOM。',
    categoryName: ' 前端 ',
    tagNames: ['性能', 'React', 'React', '  '],
  })

  assert.equal(
    source,
    '标题：React Diff\n摘要：比较新旧虚拟 DOM。\n分类：前端\n标签：React、性能',
  )
})

test('主题向量文本省略空分类和空标签', () => {
  const service = new NoteVectorSourceService()

  assert.equal(
    service.buildTopicVectorSource({ title: '标题', summary: '摘要', tagNames: [] }),
    '标题：标题\n摘要：摘要',
  )
})

test('主题向量来源哈希稳定且能识别内容变化', () => {
  const service = new NoteVectorSourceService()

  assert.equal(service.hashTopicVectorSource('same'), service.hashTopicVectorSource('same'))
  assert.notEqual(service.hashTopicVectorSource('same'), service.hashTopicVectorSource('changed'))
})
