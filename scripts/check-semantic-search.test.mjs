import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  ATLAS_VECTOR_CONTRACTS,
  evaluateSearchIndexes,
  classifySearchIndexError,
  validateDerivedSamples,
  searchMode,
} from './check-semantic-search.mjs'

test('普通同名 B-tree index 不能满足 Atlas Vector Search 契约', () => {
  const result = evaluateSearchIndexes({
    collection: 'notes',
    regularIndexes: [{ name: 'vector_index', key: { embedding: 1 } }],
    searchIndexes: [],
    contract: ATLAS_VECTOR_CONTRACTS[0],
  })

  assert.equal(result.status, 'missing')
  assert.equal(result.regularNameCollision, true)
})

test('Atlas Vector Search 必须同时匹配名称、path、维度和 similarity', () => {
  const result = evaluateSearchIndexes({
    collection: 'note_chunks',
    regularIndexes: [],
    searchIndexes: [{
      name: 'note_chunk_vector_index',
      status: 'READY',
      latestDefinition: {
        fields: [{ type: 'vector', path: 'embedding', numDimensions: 4096, similarity: 'dotProduct' }],
      },
    }],
    contract: ATLAS_VECTOR_CONTRACTS[1],
  })

  assert.equal(result.status, 'mismatch')
  assert.deepEqual(result.mismatches, ['similarity 期望 cosine，实际 dotProduct'])
})

test('无权读取 Atlas Search Index 时只报告无法确认且不猜测', () => {
  const result = classifySearchIndexError(Object.assign(new Error('not authorized on db'), { code: 13 }))

  assert.equal(result.status, 'unconfirmed')
  assert.equal(result.reason, '权限不足/无法确认')
})

test('派生数据抽样同时验证摘要、向量、正文 headingPath、HTML 和版本元数据', () => {
  const result = validateDerivedSamples([
    {
      note: { _id: 'n1', title: '标题', content: '<p>正文内容很长</p><h2>正文小标题</h2>', summary: '正文内容很长', summarySource: 'ai', embedding: [0.1] },
      chunks: [{
        headingPath: ['标题'],
        content: '<p><strong>未闭合</p>',
        embedding: [0.1],
        contentHash: '',
        embeddingModel: '',
        chunkStrategyVersion: '',
      }],
    },
  ], 4096)

  assert.deepEqual(result, {
    sampledNotes: 1,
    sampledChunks: 1,
    failures: {
      summarySource: ['n1'],
      topicEmbedding: ['n1'],
      chunkCoverage: [],
      chunkEmbedding: ['n1#0'],
      bodyHeadingPath: ['n1#0'],
      htmlStructure: ['n1#0'],
      metadata: ['n1#0'],
    },
  })
})

test('有 embedding 的笔记没有关联 Chunk 时不能以零样本误报通过', () => {
  const result = validateDerivedSamples([{
    note: { _id: 'n1', title: '标题', content: '<p>正文</p>', summary: 'AI 摘要', summarySource: 'ai', embedding: Array(4096).fill(0.1) },
    chunks: [],
  }])

  assert.deepEqual(result.failures.chunkCoverage, ['n1'])
})

test('正文没有小标题时允许 headingPath 只包含笔记标题', () => {
  const result = validateDerivedSamples([{
    note: {
      _id: 'n1', title: '标题', content: '<p>没有小标题的正文</p>', summary: '独立摘要',
      summarySource: 'ai', embedding: Array(4096).fill(0.1),
    },
    chunks: [{
      headingPath: ['标题'], content: '<p>没有小标题的正文</p>', embedding: Array(4096).fill(0.1),
      contentHash: 'hash', embeddingModel: 'model', chunkStrategyVersion: 'v1',
    }],
  }])

  assert.deepEqual(result.failures.bodyHeadingPath, [])
})

test('搜索接口成功时保留真实 HTTP status 并返回结果', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ code: 0, message: 'OK', data: { total: 1, data: [{ id: 'n1' }] } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  try {
    const result = await searchMode(`http://127.0.0.1:${address.port}`, 'token', 'query', 'keyword', 1000)
    assert.equal(result.status, 200)
    assert.equal(result.total, 1)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
