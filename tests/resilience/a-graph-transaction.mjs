// A. 知识图谱「整图替换」的原子性：故障注入 before/after 对比
//
// 对照组（after，当前实现）：knowledge-graph.service.ts 的 replace() —— withTransaction 包裹
//   删边 → 删节点 → 写节点 → 写边
// 实验组（before，历史实现）：be415a6^ (c3f0056) 的 knowledge-bases.service.ts 中同一段写序列，
//   没有 session/事务。脚本运行时用 `git show` 取回该段源码并逐字执行（不做人工转录），
//   同时记录 commit 与代码片段 hash 作为出处证据。
//
// 注入点固定为「旧图已删、新图未写完」之间：
//   I1 dup-node            ：新节点里放重复 nodeId → 真实触发 (knowledgeBaseId,userId,nodeId) 唯一索引 E11000
//   I2 throw-before-insert ：节点 insertMany 直接抛错（模拟删除后立刻发生写入失败/进程中断）
// 断言：事务版应保持旧图 100% 原样（含 _id 不变），非事务版应观察到「旧图丢失 / 半张图」。
import { execFileSync } from 'node:child_process'
import {
  mongoose, fixDns, env, loadBackendDist, REPO_ROOT,
  digestOf, sha1, createReport,
} from './_lib.mjs'

const COLL_NODES = 'zz_resilience_kg_nodes'
const COLL_EDGES = 'zz_resilience_kg_edges'
const BEFORE_COMMIT = 'be415a6^' // 事务提交的父提交：非事务版本
const TXN_COMMIT = 'be415a6' // 引入 withTransaction 的提交
const HIST_FILE = 'notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts'

fixDns()

const report = createReport('A · 图谱整图替换事务原子性（故障注入 before/after）', {
  collections: { nodes: COLL_NODES, edges: COLL_EDGES },
  after: { implementation: 'dist/modules/knowledge-bases/knowledge-graph.service.js', via: 'session.withTransaction' },
  before: { commit: BEFORE_COMMIT, file: HIST_FILE, via: 'no session (inline delete/insert)' },
  txnCommit: TXN_COMMIT,
  injectionPoints: ['I1 dup-node (真实唯一索引 E11000)', 'I2 throw-before-insert (合成写失败)'],
})

// ---------- 从 git 取回历史非事务写序列（逐字执行，不做人工转录） ----------
function loadHistoricalWriteSequence() {
  const src = execFileSync('git', ['show', `${BEFORE_COMMIT}:${HIST_FILE}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.includes('requireGraphEdgeModel().deleteMany(scope)'))
  if (start < 0) throw new Error('未在历史提交中找到非事务写序列，before 数据不可用')
  const snippet = []
  for (let i = start; i < lines.length; i += 1) {
    snippet.push(lines[i])
    if (lines[i].includes('insertMany(edges)')) break
  }
  const body = snippet
    .join('\n')
    .replace(/this\.requireGraphNodeModel\(\)/g, 'nodeModel')
    .replace(/this\.requireGraphEdgeModel\(\)/g, 'edgeModel')
  return { commit: BEFORE_COMMIT, file: HIST_FILE, startLine: start + 1, endLine: start + snippet.length, source: snippet.join('\n'), body, sha1: sha1(body) }
}

const historical = loadHistoricalWriteSequence()
// AsyncFunction 直接执行历史片段；片段内部 return 的 savedNodes/savedEdges 供断言读取
const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor
const replaceBefore = new AsyncFunction('edgeModel', 'nodeModel', 'scope', 'nodes', 'edges', `${historical.body}\nreturn { savedNodes, savedEdges }`)
report.beforeCodeProvenance = {
  commit: historical.commit,
  file: historical.file,
  lines: `${historical.startLine}-${historical.endLine}`,
  sha1: historical.sha1,
  source: historical.source,
}

// ---------- 真实基础设施 ----------
await mongoose.connect(env('MONGODB_URI'), { serverSelectionTimeoutMS: 20000, monitorCommands: true })

// 抓线级命令：证明「是否真的开了事务」以及 abort/commit 结果
const commands = []
mongoose.connection.getClient().on('commandStarted', (event) => {
  const cmd = event.command || {}
  const coll = typeof cmd[event.commandName] === 'string' ? cmd[event.commandName] : ''
  const isOurs = coll === COLL_NODES || coll === COLL_EDGES
  const isTxnControl = event.commandName === 'commitTransaction' || event.commandName === 'abortTransaction'
  if (!isOurs && !isTxnControl) return
  commands.push({
    seq: commands.length,
    commandName: event.commandName,
    collection: isOurs ? coll : undefined,
    docs: isOurs && Array.isArray(cmd.documents) ? cmd.documents.length : undefined,
    deletes: isOurs && Array.isArray(cmd.deletes) ? cmd.deletes.length : undefined,
    startTransaction: cmd.startTransaction === true || undefined,
    autocommit: isOurs && cmd.autocommit === false ? false : undefined,
    txnNumber: cmd.txnNumber === undefined ? undefined : Number(cmd.txnNumber),
  })
})

const { KnowledgeGraphService } = loadBackendDist('modules/knowledge-bases/knowledge-graph.service.js')
const graphService = new KnowledgeGraphService()

// 与生产 schema 同构（含相同唯一索引），但落在一次性集合上，不触碰真实图谱数据
const nodeSchema = new mongoose.Schema({
  knowledgeBaseId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  nodeId: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, required: true, enum: ['concept', 'entity', 'topic', 'claim'], default: 'concept' },
  confidence: { type: Number, required: true, min: 0, max: 1, default: 0.75 },
  noteIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  evidenceChunkIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
}, { collection: COLL_NODES, timestamps: true })
nodeSchema.index({ knowledgeBaseId: 1, userId: 1, nodeId: 1 }, { unique: true })

const edgeSchema = new mongoose.Schema({
  knowledgeBaseId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  edgeId: { type: String, required: true },
  source: { type: String, required: true },
  target: { type: String, required: true },
  relation: { type: String, required: true, default: '相关' },
  weight: { type: Number, required: true, min: 0, max: 1, default: 0.6 },
  noteIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  evidenceChunkIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
}, { collection: COLL_EDGES, timestamps: true })
edgeSchema.index({ knowledgeBaseId: 1, userId: 1, edgeId: 1 }, { unique: true })

const NodeModel = mongoose.model('ZZResilienceKgNode', nodeSchema)
const EdgeModel = mongoose.model('ZZResilienceKgEdge', edgeSchema)
await NodeModel.syncIndexes()
await EdgeModel.syncIndexes()

let cmdCursor = 0
const drainCommands = () => {
  const out = commands.slice(cmdCursor)
  cmdCursor = commands.length
  return out
}

const OLD_NODES = ['old-1', 'old-2', 'old-3']
const OLD_EDGES = ['old-e1', 'old-e2']

async function seedOldGraph(scope) {
  await NodeModel.deleteMany({}).exec()
  await EdgeModel.deleteMany({}).exec()
  drainCommands()
  await NodeModel.insertMany(OLD_NODES.map((id, i) => ({
    ...scope, nodeId: id, label: `旧节点${i + 1}`, type: 'concept', confidence: 0.8,
  })))
  await EdgeModel.insertMany(OLD_EDGES.map((id, i) => ({
    ...scope, edgeId: id, source: 'old-1', target: `old-${i + 2}`, relation: '相关', weight: 0.6,
  })))
  drainCommands()
  return snapshot(scope)
}

async function snapshot(scope) {
  const nodes = await NodeModel.find(scope).lean().exec()
  const edges = await EdgeModel.find(scope).lean().exec()
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeIds: nodes.map((n) => n.nodeId).sort(),
    edgeIds: edges.map((e) => e.edgeId).sort(),
    nodeIdDigest: digestOf(nodes.map((n) => n.nodeId)),
    docIdDigest: digestOf(nodes.map((n) => String(n._id))),
    edgeDocIdDigest: digestOf(edges.map((e) => String(e._id))),
    labels: nodes.map((n) => `${n.nodeId}:${n.label}`).sort(),
  }
}

function newNodesPayload(scope, { duplicate = false } = {}) {
  const docs = ['new-1', 'new-2', 'new-3', 'new-4'].map((id, i) => ({
    ...scope, nodeId: id, label: `新节点${i + 1}`, type: i % 2 ? 'topic' : 'concept', confidence: 0.9,
  }))
  if (duplicate) docs.push({ ...scope, nodeId: 'new-2', label: '新节点2-重复', type: 'concept', confidence: 0.9 })
  return docs
}

function newEdgesPayload(scope) {
  return ['new-e1', 'new-e2', 'new-e3'].map((id, i) => ({
    ...scope, edgeId: id, source: 'new-1', target: `new-${i + 2}`, relation: '相关', weight: 0.7,
  }))
}

// 在「删除已完成、写入未完成」之间注入失败：替换 insertMany 为直接抛错
function withInjectedInsertFailure(model) {
  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === 'insertMany') {
        return () => {
          const err = new Error('INJECTED_FAULT: write failed between old-graph delete and new-graph insert')
          err.injected = true
          throw err
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const scenarios = []

async function scenario({ id, variant, injection, description }) {
  const scope = { knowledgeBaseId: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId() }
  const before = await seedOldGraph(scope)
  const nodes = newNodesPayload(scope, { duplicate: injection === 'dup-node' })
  const edges = newEdgesPayload(scope)
  const nodeModel = injection === 'throw-before-insert' ? withInjectedInsertFailure(NodeModel) : NodeModel
  const edgeModel = EdgeModel

  const started = Date.now()
  let error = null
  let result = null
  const cmds = []
  try {
    if (variant === 'after') {
      result = await graphService.replace({
        connectionOwner: NodeModel,
        scope, nodes, edges, nodeModel, edgeModel,
        serialize: (savedNodes, savedEdges) => ({ nodes: savedNodes.length, edges: savedEdges.length }),
      })
    } else {
      // 历史片段返回的是写入条数；与事务版 result 保持同构
      result = await replaceBefore(edgeModel, nodeModel, scope, nodes, edges)
    }
  } catch (e) {
    error = {
      name: e && e.name,
      code: e && e.code,
      codeName: e && e.codeName,
      message: String((e && e.message) || e).slice(0, 300),
      injected: Boolean(e && e.injected),
    }
  } finally {
    cmds.push(...drainCommands())
  }
  const after = await snapshot(scope)
  const entry = {
    id, variant, injection, description,
    durationMs: Date.now() - started,
    threw: Boolean(error),
    error,
    result,
    oldGraphPreserved: before.nodeIdDigest === after.nodeIdDigest
      && before.docIdDigest === after.docIdDigest
      && before.edgeDocIdDigest === after.edgeDocIdDigest
      && before.nodeCount === after.nodeCount
      && before.edgeCount === after.edgeCount,
    before,
    after,
    newNodesWritten: after.nodeIds.filter((v) => v.startsWith('new-')).length,
    newEdgesWritten: after.edgeIds.filter((v) => v.startsWith('new-')).length,
    oldNodesRemaining: after.nodeIds.filter((v) => v.startsWith('old-')).length,
    oldEdgesRemaining: after.edgeIds.filter((v) => v.startsWith('old-')).length,
    usedTransaction: cmds.some((c) => c.startTransaction === true),
    aborted: cmds.some((c) => c.commandName === 'abortTransaction'),
    committed: cmds.some((c) => c.commandName === 'commitTransaction'),
    mongoCommands: cmds,
  }
  scenarios.push(entry)
  return entry
}

// ---------- 场景矩阵 ----------
const okAfter = await scenario({ id: 'A0', variant: 'after', injection: 'none', description: '事务版正常替换：旧图 3 节点/2 边 → 新图 4 节点/3 边' })
const okBefore = await scenario({ id: 'B0', variant: 'before', injection: 'none', description: '非事务版正常替换（before 对照组有效性验证）' })
const dupAfter = await scenario({ id: 'A1', variant: 'after', injection: 'dup-node', description: '事务版 + 新节点重复 nodeId → 写节点阶段真实 E11000' })
const dupBefore = await scenario({ id: 'B1', variant: 'before', injection: 'dup-node', description: '非事务版 + 新节点重复 nodeId → 写节点阶段真实 E11000' })
const throwAfter = await scenario({ id: 'A2', variant: 'after', injection: 'throw-before-insert', description: '事务版 + 节点 insertMany 直接抛错（删除后立即失败）' })
const throwBefore = await scenario({ id: 'B2', variant: 'before', injection: 'throw-before-insert', description: '非事务版 + 节点 insertMany 直接抛错（删除后立即失败）' })

report.scenarios = scenarios
report.comparison = [
  {
    pair: 'A1 vs B1', injection: 'dup-node',
    after: { threw: dupAfter.threw, errorCode: dupAfter.error && dupAfter.error.code, oldGraphPreserved: dupAfter.oldGraphPreserved, oldNodesRemaining: dupAfter.oldNodesRemaining, oldEdgesRemaining: dupAfter.oldEdgesRemaining, newNodesWritten: dupAfter.newNodesWritten, newEdgesWritten: dupAfter.newEdgesWritten, usedTransaction: dupAfter.usedTransaction, aborted: dupAfter.aborted },
    before: { threw: dupBefore.threw, errorCode: dupBefore.error && dupBefore.error.code, oldGraphPreserved: dupBefore.oldGraphPreserved, oldNodesRemaining: dupBefore.oldNodesRemaining, oldEdgesRemaining: dupBefore.oldEdgesRemaining, newNodesWritten: dupBefore.newNodesWritten, newEdgesWritten: dupBefore.newEdgesWritten, usedTransaction: dupBefore.usedTransaction },
  },
  {
    pair: 'A2 vs B2', injection: 'throw-before-insert',
    after: { threw: throwAfter.threw, oldGraphPreserved: throwAfter.oldGraphPreserved, oldNodesRemaining: throwAfter.oldNodesRemaining, oldEdgesRemaining: throwAfter.oldEdgesRemaining, newNodesWritten: throwAfter.newNodesWritten, newEdgesWritten: throwAfter.newEdgesWritten },
    before: { threw: throwBefore.threw, oldGraphPreserved: throwBefore.oldGraphPreserved, oldNodesRemaining: throwBefore.oldNodesRemaining, oldEdgesRemaining: throwBefore.oldEdgesRemaining, newNodesWritten: throwBefore.newNodesWritten, newEdgesWritten: throwBefore.newEdgesWritten },
  },
]

// ---------- 断言 ----------
const isDupKey = (err) => Boolean(err) && (err.code === 11000 || err.codeName === 'DuplicateKey' || /E11000|duplicate key/i.test(err.message || ''))

report.check('before 源码来自 git 历史提交（非人工重写，附 sha1）', historical.sha1.length === 40 && historical.source.includes('deleteMany(scope)'), { commit: historical.commit, lines: `${historical.startLine}-${historical.endLine}`, sha1: historical.sha1 })
report.check('A0 事务版成功路径：新图完整落库', !okAfter.threw && okAfter.newNodesWritten === 4 && okAfter.newEdgesWritten === 3, { newNodes: okAfter.newNodesWritten, newEdges: okAfter.newEdgesWritten })
report.check('B0 非事务版成功路径可跑通（before 对照组有效）', !okBefore.threw && okBefore.newNodesWritten === 4 && okBefore.newEdgesWritten === 3, { newNodes: okBefore.newNodesWritten, newEdges: okBefore.newEdgesWritten })

report.check('A1 事务版 + 唯一索引冲突：请求失败', dupAfter.threw && isDupKey(dupAfter.error), dupAfter.error)
report.check('A1 事务版：旧图 3 节点/2 边完整保留（_id 未变）', dupAfter.oldGraphPreserved && dupAfter.oldNodesRemaining === 3 && dupAfter.oldEdgesRemaining === 2, { oldNodesRemaining: dupAfter.oldNodesRemaining, oldEdgesRemaining: dupAfter.oldEdgesRemaining })
report.check('A1 事务版：不存在半张新图', dupAfter.newNodesWritten === 0 && dupAfter.newEdgesWritten === 0, { newNodes: dupAfter.newNodesWritten, newEdges: dupAfter.newEdgesWritten })
report.check('A1 事务版：走真实事务且未提交', dupAfter.usedTransaction && dupAfter.committed === false, { usedTransaction: dupAfter.usedTransaction, aborted: dupAfter.aborted, committed: dupAfter.committed })

report.check('B1 非事务版 + 唯一索引冲突：请求同样失败', dupBefore.threw && isDupKey(dupBefore.error), dupBefore.error)
report.check('B1 非事务版：旧图 3 节点/2 边全被删除（未保留）', !dupBefore.oldGraphPreserved && dupBefore.oldNodesRemaining === 0 && dupBefore.oldEdgesRemaining === 0, { oldNodesRemaining: dupBefore.oldNodesRemaining, oldEdgesRemaining: dupBefore.oldEdgesRemaining })
report.check('B1 非事务版：出现半张图（有新节点但 0 条边）', dupBefore.newNodesWritten > 0 && dupBefore.newEdgesWritten === 0, { newNodes: dupBefore.newNodesWritten, newEdges: dupBefore.newEdgesWritten })
report.check('B1 非事务版：全程无事务', !dupBefore.usedTransaction && !dupBefore.aborted, { usedTransaction: dupBefore.usedTransaction })

report.check('A2 事务版 + 删除后写入失败：旧图完整保留', throwAfter.threw && throwAfter.oldGraphPreserved && throwAfter.oldNodesRemaining === 3 && throwAfter.oldEdgesRemaining === 2, { threw: throwAfter.threw, oldNodesRemaining: throwAfter.oldNodesRemaining, oldEdgesRemaining: throwAfter.oldEdgesRemaining })
report.check('A2 事务版：无任何新图残留', throwAfter.newNodesWritten === 0 && throwAfter.newEdgesWritten === 0, { newNodes: throwAfter.newNodesWritten, newEdges: throwAfter.newEdgesWritten })

report.check('B2 非事务版 + 删除后写入失败：旧图被清空（图谱整体丢失）', throwBefore.threw && throwBefore.oldNodesRemaining === 0 && throwBefore.oldEdgesRemaining === 0 && throwBefore.newNodesWritten === 0, { oldNodesRemaining: throwBefore.oldNodesRemaining, oldEdgesRemaining: throwBefore.oldEdgesRemaining, newNodes: throwBefore.newNodesWritten })

// ---------- 清理 ----------
await NodeModel.deleteMany({}).exec()
await EdgeModel.deleteMany({}).exec()
await NodeModel.collection.drop().catch(() => {})
await EdgeModel.collection.drop().catch(() => {})
const residue = {
  nodes: await mongoose.connection.db.collection(COLL_NODES).countDocuments().catch(() => 0),
  edges: await mongoose.connection.db.collection(COLL_EDGES).countDocuments().catch(() => 0),
}
report.cleanup = { droppedCollections: [COLL_NODES, COLL_EDGES], residue }
report.check('清理：一次性集合已删除且无残留', residue.nodes === 0 && residue.edges === 0, residue)

await mongoose.disconnect()
report.finish('a-graph-transaction.json')
