/**
 * 指标 5：RAG 降级可用 —— 人为让 agent 检索抛错时，仍走固定管线并给出回答的比例
 * 无对外故障注入开关，故在服务层用真实类做故障注入测量：
 *   真实 RagStreamService / RagAgentService / QueryPlannerService / RagRetrievalService，
 *   仅在 AiGatewayClient 边界注入 agent 故障；固定管线为真实实现，其底层 chunk 检索用 stub 返回真实形状数据。
 * 证据：docs/metrics/raw/m5-rag-degrade.json
 */
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RagStreamService } from '../src/modules/ai/rag/rag-stream.service'
import { RagAgentService } from '../src/modules/ai/rag/rag-agent.service'
import { QueryPlannerService } from '../src/modules/ai/rag/query-planner.service'
import { RagRetrievalService } from '../src/modules/ai/rag/rag-retrieval.service'

const CHUNKS = [{ noteId: 'n1', title: 'React 笔记', chunkId: 'c1', headingPath: ['前端'], content: 'React 是用于构建 UI 的库。', score: 0.91 }]

function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) { for (const p of parts) controller.enqueue(encoder.encode(p)); controller.close() },
  })
}

type Fault = { name: string; make: () => any }
const FAULTS: Fault[] = [
  { name: 'Error(agent unavailable)', make: () => new Error('agent unavailable') },
  { name: 'SyntaxError(模型返回非法 JSON)', make: () => new SyntaxError('Unexpected token < in JSON') },
  { name: 'TypeError(响应结构异常)', make: () => new TypeError('Cannot read properties of undefined') },
  { name: 'ProviderCapacity(siliconflow 容量不足)', make: () => new Error('siliconflow capacity is temporarily unavailable') },
  { name: 'TimeoutError(提供商超时)', make: () => Object.assign(new Error('provider timeout after 60000ms'), { name: 'TimeoutError' }) },
  { name: 'throw string(非 Error 抛出)', make: () => 'boom' },
  { name: 'throw undefined(null 抛出)', make: () => undefined },
]

const results: any[] = []

function build(fault: Fault | null, opts: { toolThrows?: boolean; agentSucceeds?: boolean; agentToolThrows?: boolean; partialToolThrows?: boolean; emptyRetrieval?: boolean; badArgsThenUnknownTool?: boolean } = {}) {
  const state = { plannerCalls: 0, retrievalCalls: 0, agentRounds: 0, streamCalls: 0 }
  const gateway: any = {
    chatToolRound: async () => {
      state.agentRounds += 1
      if (fault) throw fault.make()
      if (opts.badArgsThenUnknownTool) {
        // 第 1 轮：非法 JSON 参数；第 2 轮：未知工具；之后停止。两者都属模型用法错误。
        if (state.agentRounds === 1) {
          return { content: '', toolCalls: [{ id: 'call_1', name: 'search_vector', arguments: '{不是合法 JSON' }] }
        }
        if (state.agentRounds === 2) {
          return { content: '', toolCalls: [{ id: 'call_2', name: 'no_such_tool', arguments: '{}' }] }
        }
        return { content: '停止。', toolCalls: [] }
      }
      if (opts.agentSucceeds) {
        if (opts.partialToolThrows) {
          // 第 1 轮关键词检索失败，第 2 轮换成语义检索成功：toolFailures>0 但证据非空。
          if (state.agentRounds === 1) {
            return { content: '', toolCalls: [{ id: 'call_1', name: 'search_keyword', arguments: JSON.stringify({ query: 'React 是什么', limit: 8 }) }] }
          }
          if (state.agentRounds === 2) {
            return { content: '', toolCalls: [{ id: 'call_2', name: 'search_vector', arguments: JSON.stringify({ query: 'React 是什么', limit: 8 }) }] }
          }
          return { content: '已收集足够证据。', toolCalls: [] }
        }
        if (state.agentRounds === 1) {
          return { content: '', toolCalls: [{ id: 'call_1', name: 'search_vector', arguments: JSON.stringify({ query: 'React 是什么', limit: 8 }) }] }
        }
        return { content: '已收集足够证据。', toolCalls: [] }
      }
      return { content: '', toolCalls: [] }
    },
    chatTask: async () => ({ content: JSON.stringify({ query: 'React 是什么', keywords: ['React'] }) }),
    describeTaskRoute: () => ({ provider: 'siliconflow', model: 'stub-model' }),
    rerank: async (_q: string, docs: string[]) => docs.map(() => 0.8),
    streamTask: async () => { state.streamCalls += 1; return sseStream(['React 是用于构建 UI 的库 [E', '1]。']) },
  }
  const chunkRetrieval: any = {
    searchChunks: async () => {
      if (opts.toolThrows) throw new Error('vector store unavailable')
      return opts.emptyRetrieval ? [] : CHUNKS
    },
    searchKeywordChunks: async () => {
      if (opts.toolThrows) throw new Error('keyword index unavailable')
      return opts.emptyRetrieval ? [] : CHUNKS
    },
    getChunkById: async () => CHUNKS[0],
  }
  const kb: any = { expandGraphEvidence: async () => [], expandGraphEvidenceAuto: async () => [] }
  const planner = new QueryPlannerService(gateway)
  const realPlanner = { plan: async (q: string) => { state.plannerCalls += 1; return planner.plan(q) } }
  const retrieval = new RagRetrievalService(chunkRetrieval, kb, gateway)
  const realRetrieval = { retrieve: async (...a: any[]) => { state.retrievalCalls += 1; return (retrieval as any).retrieve(...a) } }
  // agent 侧工具后端可与固定管线分离，用于区分「只有 agent 工具坏」与「检索后端整体坏」
  const agentChunks: any = opts.agentToolThrows
    ? { searchChunks: async () => { throw new Error('agent tool vector store unavailable') }, searchKeywordChunks: async () => { throw new Error('agent tool keyword index unavailable') }, getChunkById: async () => CHUNKS[0] }
    : opts.partialToolThrows
      // 仅 agent 侧的关键词检索失败：模型换用语义检索后仍能拿到证据 → toolFailures>0 但 evidence 非空
      ? { searchChunks: async () => (opts.emptyRetrieval ? [] : CHUNKS), searchKeywordChunks: async () => { throw new Error('agent keyword index unavailable') }, getChunkById: async () => CHUNKS[0] }
      : chunkRetrieval
  const agent = new RagAgentService(gateway, agentChunks, kb, undefined)
  return { service: new RagStreamService(realPlanner as any, realRetrieval as any, gateway, agent), state }
}

for (const fault of FAULTS) {
  test(`指标5 降级：agent 抛错(${fault.name})时仍走固定管线并给出回答`, async () => {
    const { service, state } = build(fault)
    const deltas: string[] = []
    const result = await service.streamRagAnswer(
      { question: 'React 是什么', userId: 'u1' },
      { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } },
    )
    const answer = deltas.join('')
    const rec: any = {
      fault: fault.name,
      degradedToFixedPipeline: state.plannerCalls > 0 && state.retrievalCalls > 0,
      plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls, agentRounds: state.agentRounds,
      answered: answer.length > 0, answerLength: answer.length, answerSample: answer.slice(0, 60),
      citationCount: result.citations.length, route: result.route, runId: result.runId ?? null,
      threw: false, answeredViaFixedPipeline: false,
    }
    rec.answeredViaFixedPipeline = rec.degradedToFixedPipeline && rec.answered
    results.push(rec)
    assert.equal(rec.degradedToFixedPipeline, true, `fault=${fault.name} 未走固定管线`)
    assert.equal(rec.answered, true, `fault=${fault.name} 未给出回答`)
    assert.ok(result.citations.length >= 1, `fault=${fault.name} 缺少引用`)
  })
}

test('指标5 边界（已修复）：工具层执行抛错导致证据为空时，降级固定管线并给出回答', async () => {
  // 缺陷修复（2026-09-10）：修复前 executeTool 吞掉工具异常且不留痕，agent 返回空证据，
  // RagStreamService 直接回「未找到足够笔记证据」—— 把"检索后端故障"说成了"用户没有相关笔记"。
  // 现在 agent 会上报 toolFailures，证据为空且 toolFailures>0 时降级固定管线。
  // 只让 agent 侧工具坏（agentToolThrows），固定管线的 chunk 检索保持健康 —— 这样降级才有意义。
  const { service, state } = build(null, { agentToolThrows: true, agentSucceeds: true })
  const deltas: string[] = []
  const result = await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } })
  const answer = deltas.join('')
  const rec: any = {
    fault: 'tool execution throws (search_vector/search_keyword)',
    degradedToFixedPipeline: state.plannerCalls > 0 && state.retrievalCalls > 0,
    plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls, agentRounds: state.agentRounds,
    answered: answer.length > 0, answerLength: answer.length, citationCount: result.citations.length,
    route: result.route, runId: result.runId ?? null, threw: false, answeredViaFixedPipeline: false,
    warnings: result.warnings,
    toolFailureWarned: result.warnings.some((w) => w.includes('检索工具异常')),
    fixed: 'tool-level failure -> empty evidence -> now degrades to fixed pipeline',
  }
  rec.answeredViaFixedPipeline = rec.degradedToFixedPipeline && rec.answered
  results.push(rec)
  assert.equal(state.plannerCalls, 1, '工具异常且证据为空时应降级固定管线')
  assert.equal(rec.answered, true, '降级后应给出回答')
  assert.ok(rec.toolFailureWarned, 'warnings 应包含「检索工具异常」以区分故障与"没有笔记"')
  assert.ok(result.warnings.includes('检索工具异常，已改用固定管线'))
})

test('指标5 边界：agent 已拿到证据时不因工具异常降级（避免重复检索）', async () => {
  // 只让"第一轮某次检索"失败，模型随后换关键词成功 → toolFailures>0 但 evidence 非空 → 不得降级。
  const { service, state } = build(null, { partialToolThrows: true, agentSucceeds: true })
  const deltas: string[] = []
  await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } })
  results.push({
    fault: '(边界) tool failure but evidence non-empty',
    degradedToFixedPipeline: state.plannerCalls > 0, plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls,
    answered: deltas.join('').length > 0, answeredViaFixedPipeline: false, expectedNoDegrade: true,
  })
  assert.equal(state.plannerCalls, 0, '已有证据时不得重复检索固定管线')
  assert.ok(deltas.join('').length > 0)
})

test('指标5 边界：工具正常但确实无命中（toolFailures=0、证据为空）不降级', async () => {
  // 这才是"用户真的没有相关笔记"，必须保持原行为：不降级、提示未找到证据。
  const { service, state } = build(null, { emptyRetrieval: true, agentSucceeds: true })
  const deltas: string[] = []
  const result = await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } })
  results.push({
    fault: '(边界) tool ok but no hits',
    degradedToFixedPipeline: state.plannerCalls > 0, plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls,
    answered: deltas.join('').length > 0, answeredViaFixedPipeline: false, expectedNoDegrade: true,
    warnings: result.warnings,
  })
  assert.equal(state.plannerCalls, 0, '真实无命中不应触发降级')
  assert.ok(result.warnings.includes('未找到足够笔记证据'))
  assert.equal(result.warnings.some((w) => w.includes('检索工具异常')), false)
})

test('指标5 边界：模型用法错误（非法 JSON 参数 / 未知工具）不计入 toolFailures、不降级', async () => {
  // 参数写错是模型可自纠的用法错误，不能当成"检索后端故障"，否则正常自纠也会触发降级。
  const { service, state } = build(null, { badArgsThenUnknownTool: true })
  const deltas: string[] = []
  await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } })
  results.push({
    fault: '(边界) model misuse: bad args / unknown tool',
    degradedToFixedPipeline: state.plannerCalls > 0, plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls,
    answered: deltas.join('').length > 0, answeredViaFixedPipeline: false, expectedNoDegrade: true,
  })
  assert.equal(state.plannerCalls, 0, '模型用法错误不得触发降级')
})

test('指标5 补充：仅 agent 工具后端不可用且 loop 抛错时，仍能降级给出回答', async () => {
  const { service, state } = build(new Error('agent tool backend down') as any, { agentToolThrows: true })
  const deltas: string[] = []
  const result = await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } })
  const rec: any = {
    fault: 'agent tool backend down + agent loop throws',
    degradedToFixedPipeline: state.plannerCalls > 0 && state.retrievalCalls > 0,
    plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls, agentRounds: state.agentRounds,
    answered: deltas.join('').length > 0, answerLength: deltas.join('').length,
    citationCount: result.citations.length, threw: false, answeredViaFixedPipeline: false,
  }
  rec.answeredViaFixedPipeline = rec.degradedToFixedPipeline && rec.answered
  results.push(rec)
  assert.equal(rec.answeredViaFixedPipeline, true)
})

test('指标5 边界：检索后端整体不可用（agent 与固定管线共用的 chunk 检索都抛错）时无法作答', async () => {
  const { service, state } = build(new Error('agent unavailable') as any, { toolThrows: true })
  let threw = false
  let message = ''
  try {
    await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async () => undefined })
  } catch (e: any) { threw = true; message = String(e?.message) }
  results.push({
    fault: 'retrieval backend fully down (agent + fixed pipeline)',
    degradedToFixedPipeline: state.plannerCalls > 0, plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls,
    answered: false, threw, errorMessage: message, answeredViaFixedPipeline: false, expectedThrows: true,
  })
  assert.equal(threw, true, '检索后端整体不可用时应向外抛错，而不是静默给出空回答')
  assert.equal(state.plannerCalls, 1, '应尝试过固定管线')
})

test('指标5 对照：agent 正常时不降级，直接用 agent 证据作答', async () => {
  const { service, state } = build(null, { agentSucceeds: true })
  const deltas: string[] = []
  const result = await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async (t) => { deltas.push(t) } })
  const answer = deltas.join('')
  const rec: any = {
    fault: '(对照) agent 正常', degradedToFixedPipeline: state.plannerCalls > 0,
    plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls, agentRounds: state.agentRounds,
    answered: answer.length > 0, answerLength: answer.length, citationCount: result.citations.length,
    threw: false, answeredViaFixedPipeline: false, expectedNoDegrade: true,
  }
  results.push(rec)
  assert.equal(state.plannerCalls, 0, 'agent 正常路径不应调用固定管线')
  assert.equal(rec.answered, true)
})

test('指标5 边界：CANCELLED 不触发降级（取消不等于故障）', async () => {
  const { service, state } = build({ name: 'CANCELLED', make: () => new Error('CANCELLED') })
  let threw = false
  let message = ''
  try {
    await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async () => undefined })
  } catch (e: any) { threw = true; message = String(e?.message) }
  results.push({
    fault: 'CANCELLED', degradedToFixedPipeline: state.plannerCalls > 0,
    plannerCalls: state.plannerCalls, retrievalCalls: state.retrievalCalls,
    answered: false, threw, errorMessage: message, answeredViaFixedPipeline: false, expectedPropagate: true,
  })
  assert.equal(threw, true, 'CANCELLED 应向外传播')
  assert.equal(state.plannerCalls, 0, 'CANCELLED 不应触发降级重查')
  assert.equal(message, 'CANCELLED')
})

test.after(() => {
  const faultCases = results.filter((r) => !r.expectedNoDegrade && !r.expectedPropagate && !r.expectedThrows && !r.finding && !r.fault.startsWith('tool execution'))
  const summary = {
    metric: 'M5 RAG degrade availability',
    generatedAt: new Date().toISOString(),
    method: 'service-level fault injection on real RagStreamService/RagAgentService/QueryPlannerService/RagRetrievalService; only AiGatewayClient boundary stubbed',
    agentFaultCases: faultCases.length,
    agentFaultAnsweredViaFixedPipeline: faultCases.filter((r) => r.answeredViaFixedPipeline).length,
    agentFaultAvailabilityRate: faultCases.length ? faultCases.filter((r) => r.answeredViaFixedPipeline).length / faultCases.length : 0,
    toolFaultAnswered: results.filter((r) => r.fault.startsWith('tool execution')).map((r) => r.answered),
    agentToolBackendDownAnswered: results.filter((r) => r.fault.startsWith('agent tool backend down')).map((r) => r.answeredViaFixedPipeline),
    retrievalBackendFullyDownThrows: results.filter((r) => r.expectedThrows).map((r) => r.threw),
    othersAnsweredViaFixedPipeline: results.filter((r) => r.expectedNoDegrade).length,
    cancelledPropagatedWithoutDegrade: results.filter((r) => r.fault === 'CANCELLED').map((r) => r.threw && r.plannerCalls === 0),
    controlAgentNoDegrade: results.filter((r) => r.expectedNoDegrade).map((r) => r.plannerCalls === 0 && r.answered),
  }
  const dir = join(process.cwd(), '..', 'docs', 'metrics', 'raw')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'm5-rag-degrade.json'), JSON.stringify({ ...summary, cases: results }, null, 2))
  console.log('M5 SUMMARY:', JSON.stringify(summary))
})
