import { test } from 'node:test'
import assert = require('node:assert/strict')
import { RagAgentService } from '../src/modules/ai/rag/rag-agent.service'

// —— 测试脚手架：gateway / chunks / knowledgeBases / runs 均为可控 stub ——

type RoundScript = { content?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }

function makeGateway(rounds: RoundScript[]) {
  const chatToolRoundCalls: any[] = []
  let cursor = 0
  const gateway: any = {
    chatToolRoundCalls,
    chatToolRound: async (options: any) => {
      chatToolRoundCalls.push(options)
      const script = rounds[Math.min(cursor, rounds.length - 1)]
      cursor += 1
      return {
        content: script.content || '',
        toolCalls: script.toolCalls || [],
        finishReason: script.toolCalls?.length ? 'tool_calls' : 'stop',
      }
    },
    rerank: async (_query: string, documents: string[]) =>
      documents.map((_doc, index) => ({ index, score: 1 - index * 0.01 })),
    describeTaskRoute: () => ({ provider: 'siliconflow', model: 'qwen-test' }),
  }
  return gateway
}

const chunkSearchResults = [
  { chunkId: 'c1', noteId: 'n1', title: 'React 笔记', headingPath: ['前端'], content: 'React 是前端库', score: 0.9 },
  { chunkId: 'c2', noteId: 'n1', title: 'React 笔记', headingPath: ['前端', 'hooks'], content: 'useState 用法', score: 0.8 },
]

function makeChunks() {
  return {
    searchChunks: async () => chunkSearchResults,
    searchKeywordChunks: async () => chunkSearchResults,
    getChunkById: async (chunkId: string) => {
      const hit = chunkSearchResults.find((item) => item.chunkId === chunkId)
      return hit ? { ...hit, content: `${hit.content}（完整全文部分）` } : null
    },
  }
}

const knowledgeBases = {
  expandGraphEvidence: async () => [{ chunkId: 'c3', noteId: 'n2', title: '关联笔记', headingPath: [], content: '图谱邻居证据', score: 0.35, graphPath: ['c1', 'c3'] }],
  expandGraphEvidenceAuto: async () => ({ attemptedKbs: 1, evidence: [{ chunkId: 'c3', noteId: 'n2', title: '关联笔记', headingPath: [], content: '图谱邻居证据', score: 0.35, graphPath: ['c1', 'c3'] }] }),
}

function makeRuns() {
  const calls: { start: number; addStage: string[]; mergeMetrics: number; succeed: number; fail: number } = {
    start: 0, addStage: [], mergeMetrics: 0, succeed: 0, fail: 0,
  }
  return {
    calls,
    start: async () => { calls.start += 1; return { runId: 'run-1' } },
    addStage: async (_runId: string, stage: any) => { calls.addStage.push(stage.name) },
    mergeMetrics: async () => { calls.mergeMetrics += 1 },
    succeed: async () => { calls.succeed += 1 },
    fail: async () => { calls.fail += 1 },
  }
}

function makeService(gateway: any, runs?: any) {
  return new RagAgentService(gateway, makeChunks() as any, knowledgeBases as any, runs)
}

const noHooks = { onStatus: async () => undefined }

// —— 用例 ——

test('正常流程：检索一轮后模型停止调用，证据按分数排序返回并记录 run', async () => {
  const gateway = makeGateway([
    { toolCalls: [{ id: 't1', name: 'search_vector', arguments: '{"query":"React"}' }] },
    { content: '检索完成' },
  ])
  const runs = makeRuns()
  const service = makeService(gateway, runs)
  const result = await service.collect({ question: 'React 是什么', userId: 'u1' }, noHooks)

  assert.equal(result.evidence.length, 2)
  assert.equal(result.evidence[0].chunkId, 'c1') // 0.9 分最高排前
  assert.equal(result.rounds, 2)
  assert.equal(result.toolCalls, 1)
  assert.equal(result.planSummary.intent, 'agent')
  assert.deepEqual(result.planSummary.tools, ['chunk_vector'])
  assert.equal(result.runId, 'run-1')
  assert.equal(runs.calls.start, 1)
  assert.ok(runs.calls.addStage.includes('provider'))
  assert.ok(runs.calls.addStage.includes('context_prepare'))
  // 工具请求带 tools 定义与多轮 messages
  assert.equal(gateway.chatToolRoundCalls[0].tools.length, 5)
  assert.equal(gateway.chatToolRoundCalls[0].messages[0].role, 'system')
})

test('最大轮数护栏：模型持续调用工具时 3 轮强制收敛并给出警告', async () => {
  const gateway = makeGateway([
    { toolCalls: [{ id: 't1', name: 'search_vector', arguments: '{"query":"a"}' }] },
    { toolCalls: [{ id: 't2', name: 'search_keyword', arguments: '{"query":"b"}' }] },
    { toolCalls: [{ id: 't3', name: 'expand_graph', arguments: '{}' }] },
  ])
  const service = makeService(gateway)
  const result = await service.collect({ question: '问题', userId: 'u1' }, noHooks)

  assert.equal(result.rounds, 3)
  assert.ok(result.warnings.includes('已达最大检索轮数，使用已收集证据作答'))
  assert.ok(result.planSummary.tools.includes('graph_expand'))
})

test('参数自纠：非法 JSON 与未知工具名都转为错误结果回填，不中断 loop', async () => {
  const gateway = makeGateway([
    { toolCalls: [
      { id: 't1', name: 'search_vector', arguments: '{bad json' },
      { id: 't2', name: 'not_a_tool', arguments: '{}' },
    ] },
    { content: '停止' },
  ])
  const service = makeService(gateway)
  const result = await service.collect({ question: '问题', userId: 'u1' }, noHooks)

  assert.equal(result.evidence.length, 0) // 全部失败未注册证据
  assert.equal(result.rounds, 2)          // loop 未中断，第二轮模型自行停止
  // 两个错误结果都以 tool 消息回填给模型自纠
  const toolMessages = gateway.chatToolRoundCalls[1].messages.filter((m: any) => m.role === 'tool')
  assert.equal(toolMessages.length, 2)
  assert.ok(toolMessages[0].content.includes('error'))
  assert.ok(toolMessages[1].content.includes('未知工具'))
})

test('E 编号稳定：rerank 只改分数不换顺序，get_note_chunk 按 E# 取全文', async () => {
  const gateway = makeGateway([
    { toolCalls: [{ id: 't1', name: 'search_vector', arguments: '{"query":"React"}' }] },
    { toolCalls: [
      { id: 't2', name: 'rerank', arguments: '{}' },
      { id: 't3', name: 'get_note_chunk', arguments: '{"id":"E1"}' },
    ] },
    { content: '停止' },
  ])
  const service = makeService(gateway)
  const result = await service.collect({ question: 'React 是什么', userId: 'u1' }, noHooks)

  assert.equal(result.planSummary.rerankApplied, true)
  // rerank 后顺序仍按原注册（E1=c1 在前），只更新分数
  assert.equal(result.evidence[0].chunkId, 'c1')
  // 最终证据按分数排序：rerank 给 c1 分数 1 - 0 = 1，c2 为 0.99
  assert.ok(result.evidence[0].score >= result.evidence[1].score)
})

test('get_note_chunk 未知编号返回可用编号列表，不注册证据', async () => {
  const gateway = makeGateway([
    { toolCalls: [{ id: 't1', name: 'search_vector', arguments: '{"query":"React"}' }] },
    { toolCalls: [{ id: 't2', name: 'get_note_chunk', arguments: '{"id":"E99"}' }] },
    { content: '停止' },
  ])
  const service = makeService(gateway)
  const result = await service.collect({ question: 'React 是什么', userId: 'u1' }, noHooks)
  assert.equal(result.evidence.length, 2) // 只有第一轮检索注册的 2 条
})

test('空证据：模型直接停止时不调用作答且 run 被关闭', async () => {
  const gateway = makeGateway([{ content: '我直接回答' }])
  const runs = makeRuns()
  const service = makeService(gateway, runs)
  const result = await service.collect({ question: '问题', userId: 'u1' }, noHooks)

  assert.equal(result.evidence.length, 0)
  assert.equal(result.rounds, 1)
  assert.equal(runs.calls.succeed, 1) // 空证据提前收尾关闭 run
})

test('loop 异常向外抛出并标记 run 失败（由 streamRagAnswer 负责降级）', async () => {
  const gateway: any = {
    chatToolRound: async () => { throw new Error('provider down') },
    describeTaskRoute: () => ({ provider: 'siliconflow', model: 'qwen-test' }),
  }
  const runs = makeRuns()
  const service = makeService(gateway, runs)
  await assert.rejects(
    () => service.collect({ question: '问题', userId: 'u1' }, noHooks),
    /provider down/,
  )
  assert.equal(runs.calls.fail, 1)
})

test('expand_graph 空种子时返回错误结果，图谱成功时注册邻居证据', async () => {
  // 第一轮直接 expand_graph（无种子）→ 错误；第二轮检索 + 第三轮再扩图 → 成功
  const gateway = makeGateway([
    { toolCalls: [{ id: 't1', name: 'expand_graph', arguments: '{}' }] },
    { toolCalls: [{ id: 't2', name: 'search_vector', arguments: '{"query":"React"}' }] },
    { toolCalls: [{ id: 't3', name: 'expand_graph', arguments: '{}' }] },
    { content: '停止' },
  ])
  const service = makeService(gateway)
  const result = await service.collect({ question: '问题', userId: 'u1' }, noHooks)

  assert.equal(result.evidence.length, 3) // c1 c2 + 图谱邻居 c3
  assert.equal(result.planSummary.graphHops, 1)
})

test('知识库范围：search 与 expand 透传 knowledgeBaseId（权限边界由底层服务保障）', async () => {
  const gateway = makeGateway([
    { toolCalls: [{ id: 't1', name: 'search_keyword', arguments: '{"query":"React","keywords":["hooks"]}' }] },
    { content: '停止' },
  ])
  const chunks: any = makeChunks()
  let seenInput: any
  chunks.searchKeywordChunks = async (input: any) => { seenInput = input; return chunkSearchResults }
  const service = new RagAgentService(gateway, chunks as any, knowledgeBases as any, undefined)
  await service.collect({ question: '问题', userId: 'u1', knowledgeBaseId: 'kb-9' }, noHooks)
  assert.equal(seenInput.knowledgeBaseId, 'kb-9')
  assert.deepEqual(seenInput.keywords, ['hooks'])
})
