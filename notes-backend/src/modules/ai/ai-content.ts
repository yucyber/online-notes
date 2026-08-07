import { extractJsonObject, stripCodeFence } from './ai-output'
import type { AiWriterInput } from './ai-gateway.types'

export function buildWriterPrompt(input: AiWriterInput): string {
  const context = cleanText(input.context || '')
  const extra = input.prompt ? `\nAdditional user requirement:\n${input.prompt}` : ''
  if (input.type === 'continue') return `Continue the following text in the same language and style. Return only the continuation.\n\nContext:\n${context}${extra}`
  if (input.type === 'polish') return `Polish the following text while preserving its meaning. Return only the polished text.\n\nText:\n${context}${extra}`
  return `Summarize the following text concisely. Return only the summary.\n\nText:\n${context}${extra}`
}

export function buildMindmapPrompt(scenario: string, content: any): string {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  if (scenario === 'expand') return ['Expand this mind map node with 2-5 useful child nodes.', 'Return valid JSON only. The root id and topic must match the input node.', 'Schema: {"id":"node-id","topic":"node topic","children":[{"id":"unique-id","topic":"child topic","children":[]]}', '', serialized].join('\n')
  if (scenario === 'optimize') return ['Optimize this mind map JSON. Merge duplicates, improve wording, and keep the same overall structure.', 'Return valid JSON only with schema: {"nodeData":{"id":"root","topic":"topic","children":[]}}.', '', serialized].join('\n')
  return ['Generate a mind map in Chinese unless the topic is clearly another language.', 'Return valid JSON only with schema: {"nodeData":{"id":"root","topic":"topic","children":[{"id":"child1","topic":"child topic","children":[]}]}}.', 'Every node must have a unique id and a topic.', '', `Topic: ${serialized}`].join('\n')
}

export function buildMindmapRepairPrompt(answer: string, scenario: string, content: any): string {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  return ['Repair this mind map JSON.', 'Return valid JSON only. Do not wrap it in Markdown fences.', 'Required schema: {"nodeData":{"id":"root","topic":"topic","root":true,"children":[{"id":"root-1","topic":"child topic","children":[]}]},"linkData":{}}.', 'Every node must have a non-empty topic, a unique id, and a children array.', '', `Scenario: ${scenario}`, `Original user input:\n${serialized}`, '', `Invalid model output:\n${answer}`].join('\n')
}

export function buildMermaidPrompt(content: string, availableIcons: string[]): string {
  const iconHint = availableIcons.length > 0 ? `\nAvailable custom icon names. Prefer these exact names as node labels when semantically relevant: ${availableIcons.join(', ')}` : ''
  return ['Generate Mermaid.js code for the user request.', 'Return Mermaid code only. Do not wrap in Markdown fences and do not add explanations.', 'Use simple compatible syntax. Choose flowchart, sequenceDiagram, classDiagram, stateDiagram, or erDiagram as appropriate.', iconHint, '', `User request:\n${content}`].join('\n')
}

export function buildMermaidRepairPrompt(answer: string, content: string, availableIcons: string[]): string {
  const iconHint = availableIcons.length > 0 ? `\nAvailable custom icon names: ${availableIcons.join(', ')}` : ''
  return ['Repair this Mermaid output.', 'Return Mermaid code only. Do not wrap it in Markdown fences and do not add explanations.', 'The first non-empty line must start with a Mermaid diagram declaration such as flowchart TD, graph LR, sequenceDiagram, classDiagram, stateDiagram, or erDiagram.', 'Use simple compatible syntax.', iconHint, '', `Original user request:\n${content}`, '', `Invalid model output:\n${answer}`].join('\n')
}

// 先剥离 Markdown 代码围栏，再提取最外层 JSON 对象，最后规范化节点树。
// 规范化失败时由调用方发起修复请求，不在此处抛出异常。
export function normalizeMindmapAnswer(answer: string) {
  const json = extractJsonObject(answer)
  if (!json) return null
  let parsed: any
  try { parsed = JSON.parse(json) } catch { return null }
  const root = normalizeMindmapNode(parsed?.nodeData || parsed?.root || parsed, 'root', new Set<string>(), true)
  if (!root) return null
  return { nodeData: root, linkData: parsed?.linkData && typeof parsed.linkData === 'object' && !Array.isArray(parsed.linkData) ? parsed.linkData : {} }
}

function normalizeMindmapNode(raw: any, fallbackId: string, usedIds: Set<string>, isRoot = false): any | null {
  if (!raw || typeof raw !== 'object') return null
  const topic = cleanNodeTopic(raw.topic ?? raw.content ?? raw.label ?? raw.name)
  if (!topic) return null
  const id = isRoot ? 'root' : uniqueNodeId(raw.id, fallbackId, usedIds)
  usedIds.add(id)
  const rawChildren = Array.isArray(raw.children) ? raw.children : Array.isArray(raw.nodes) ? raw.nodes : []
  const children = rawChildren.map((child: any, index: number) => normalizeMindmapNode(child, `${id}-${index + 1}`, usedIds)).filter(Boolean)
  const node: any = { id, topic, children }
  if (isRoot) node.root = true
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) node.data = raw.data
  return node
}

// ID 去重确保导图库不会因重复 id 产生渲染异常；根节点 id 固定为 "root" 以满足库的约定。
function uniqueNodeId(rawId: unknown, fallbackId: string, usedIds: Set<string>) {
  const base = String(rawId || fallbackId).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallbackId
  if (!usedIds.has(base)) return base
  let index = 2
  while (usedIds.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function cleanNodeTopic(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200) }

export function normalizeMermaidCode(answer: string): string | null {
  const code = stripCodeFence(answer).trim()
  if (!code || code.includes('```')) return null
  const firstLine = code.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('%%'))
  if (!firstLine || !isMermaidDeclaration(firstLine)) return null
  return code
}

function isMermaidDeclaration(line: string) { return /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/i.test(line) || /^(sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|gantt|journey|pie|mindmap|gitGraph)\b/i.test(line) }

export function cleanTopicName(value: string) { return String(value || '').split('\n')[0].replace(/^["'`]+|["'`]+$/g, '').replace(/[。.!?，,]+$/g, '').trim().slice(0, 80) || 'General Topic' }
export function cleanText(content: string) { return String(content || '').replace(/<[^>]+>/g, '').replace(/[#*`_~>\[\]()]/g, '').replace(/\s+/g, ' ').trim() }
export function truncateContent(content: string) { const cleaned = cleanText(content); return cleaned.substring(0, 200) + (cleaned.length > 200 ? '...' : '') }
