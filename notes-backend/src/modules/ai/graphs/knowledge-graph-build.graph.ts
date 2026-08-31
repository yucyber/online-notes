import { Injectable } from '@nestjs/common'
import {
  clampUnitInterval,
  normalizeKnowledgeGraphNodeType,
  normalizeKnowledgeGraphNoteIds,
  normalizeKnowledgeGraphRelation,
  resolveKnowledgeGraphEdgeNoteIds,
  uniqueStrings,
  type KnowledgeGraphNodeType,
} from '../../knowledge-bases/knowledge-graph-normalize'
import { AiGatewayClient } from '../ai-gateway.client'
import { AiWorkflowContext } from '../ai-gateway.types'
import { parseJsonObject } from '../ai-output'

export type { KnowledgeGraphNodeType }

export interface KnowledgeGraphBuildInput {
  knowledgeBaseId: string
  notes: Array<{
    id: string
    title?: string
    summary?: string
    content?: string
    chunks?: Array<{ chunkId: string; headingPath?: string[]; content?: string }>
    updatedAt?: string
  }>
}

export interface KnowledgeGraphProposalNode {
  id: string
  label: string
  type: KnowledgeGraphNodeType
  confidence: number
  noteIds: string[]
  evidenceChunkIds: string[]
}

export interface KnowledgeGraphProposalEdge {
  id: string
  source: string
  target: string
  relation: string
  weight: number
  noteIds: string[]
  evidenceChunkIds: string[]
}

export interface KnowledgeGraphProposal {
  knowledgeBaseId: string
  generatedAt: string
  nodes: KnowledgeGraphProposalNode[]
  edges: KnowledgeGraphProposalEdge[]
  warnings: string[]
}

export interface KnowledgeGraphBuildGraphOptions {
  maxNotes?: number
  maxNoteChars?: number
  maxNodes?: number
  maxEdges?: number
  maxChunks?: number
  maxChunkChars?: number
}

type PreparedGraphNote = Required<Pick<KnowledgeGraphBuildInput['notes'][number], 'id' | 'title' | 'summary' | 'updatedAt'>> & { chunks: Array<{ chunkId: string; headingPath: string[]; content: string }> }

export interface PreparedKnowledgeGraphBuildInput {
  knowledgeBaseId: string
  notes: PreparedGraphNote[]
  prompt: string
}

@Injectable()
export class KnowledgeGraphBuildGraph {
  private readonly maxNotes: number
  private readonly maxNoteChars: number
  private readonly maxNodes: number
  private readonly maxEdges: number
  private readonly maxChunks: number
  private readonly maxChunkChars: number

  constructor(
    private readonly gateway: AiGatewayClient,
    options: KnowledgeGraphBuildGraphOptions = {},
  ) {
    this.maxNotes = options.maxNotes || 40
    this.maxNoteChars = options.maxNoteChars || 1600
    this.maxNodes = options.maxNodes || 14
    this.maxEdges = options.maxEdges || 20
    this.maxChunks = options.maxChunks || 120
    this.maxChunkChars = options.maxChunkChars || 800
  }

  async run(input: KnowledgeGraphBuildInput, context?: AiWorkflowContext): Promise<KnowledgeGraphProposal> {
    return this.runPrepared(this.prepare(input), context)
  }

  prepare(input: KnowledgeGraphBuildInput): PreparedKnowledgeGraphBuildInput {
    const knowledgeBaseId = String(input?.knowledgeBaseId || '').trim()
    const notes = this.prepareNotes(input?.notes || [])
    if (!knowledgeBaseId) throw new Error('knowledgeBaseId is required.')

    return {
      knowledgeBaseId,
      notes,
      prompt: notes.length > 0 ? this.buildPrompt(knowledgeBaseId, notes) : '',
    }
  }

  async runPrepared(input: PreparedKnowledgeGraphBuildInput, context?: AiWorkflowContext): Promise<KnowledgeGraphProposal> {
    const { knowledgeBaseId, notes } = input

    if (notes.length === 0) {
      return {
        knowledgeBaseId,
        generatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
        warnings: ['No readable notes found in this knowledge base.'],
      }
    }

    const answer = (await this.gateway.chatTask({
      task: 'knowledge_graph',
      system: 'You extract knowledge graph proposals for a notes knowledge base. Return JSON only.',
      prompt: input.prompt,
      maxTokens: 4096,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      audit: { graphName: 'KnowledgeGraphBuildGraph', userId: context?.userId, runId: context?.runId },
    })).content

    return this.normalizeProposal(knowledgeBaseId, notes, parseJsonObject(answer))
  }

  private prepareNotes(notes: KnowledgeGraphBuildInput['notes']): PreparedGraphNote[] {
    let remainingChunks = this.maxChunks
    return (Array.isArray(notes) ? notes : [])
      .slice(0, this.maxNotes)
      .map((note, index) => {
        const id = String(note?.id || '').trim()
        const title = String(note?.title || `Note ${index + 1}`).trim()
        const summary = this.cleanText(note?.summary || '').slice(0, 800)
        const chunks = (Array.isArray(note?.chunks) ? note.chunks : []).flatMap((chunk) => {
          if (remainingChunks <= 0) return []
          const chunkId = String(chunk?.chunkId || '').trim()
          const content = this.cleanText(chunk?.content || '').slice(0, Math.min(this.maxNoteChars, this.maxChunkChars))
          if (!chunkId || !content) return []
          remainingChunks -= 1
          return [{ chunkId, headingPath: (Array.isArray(chunk?.headingPath) ? chunk.headingPath : []).map(String), content }]
        })
        const updatedAt = note?.updatedAt ? this.safeDate(note.updatedAt) : 'unknown time'
        return { id, title, summary, chunks, updatedAt }
      })
      .filter((note) => note.id && (note.title || note.summary || note.chunks.length > 0))
  }

  private buildPrompt(knowledgeBaseId: string, notes: PreparedGraphNote[]) {
    return [
      `Knowledge base: ${knowledgeBaseId}`,
      'Extract a knowledge graph proposal from ONLY the notes listed below.',
      'Return strict JSON with this shape:',
      '{"nodes":[{"label":"string","type":"concept|entity|topic|claim","noteIds":["note id"],"evidenceChunkIds":["chunk id"],"confidence":0.0}],"edges":[{"source":"node label","target":"node label","relation":"string","noteIds":["note id"],"evidenceChunkIds":["chunk id"],"weight":0.0}],"warnings":["string"]}',
      'Only cite noteIds and chunkIds present in the input. If evidence is uncertain, return an empty evidenceChunkIds array. Never invent IDs.',
      '每个节点或边最多引用 2 条最相关的 evidenceChunkIds，不要超量罗列证据。',
      '优先发现不同 Note ID 之间有证据的关系，并比较不同笔记中的概念、实体、主题和主张。',
      '关系使用简洁中文。没有可靠证据时不要连线，保持节点断开。',
      '合并表达相同或近义概念的节点，避免重复。',
      `最多返回 ${this.maxNodes} 个 nodes 和 ${this.maxEdges} 个 edges，优先保留跨笔记边和高价值内部边。`,
      '',
      notes.map((note) => [
        `Note ID: ${note.id}`,
        `Title: ${note.title}`,
        `Updated: ${note.updatedAt}`,
        note.summary ? `Summary: ${note.summary}` : '',
        note.chunks.map((chunk) => `Chunk ID: ${chunk.chunkId}\nHeading: ${chunk.headingPath.join(' > ')}\nExcerpt: ${chunk.content}`).join('\n\n'),
      ].filter(Boolean).join('\n')).join('\n\n---\n\n'),
    ].join('\n')
  }

  private normalizeProposal(knowledgeBaseId: string, notes: PreparedGraphNote[], raw: any): KnowledgeGraphProposal {
    const allowedNoteIds = new Set(notes.map((note) => note.id))
    const allowedChunkIds = new Set(notes.flatMap((note) => note.chunks.map((chunk) => chunk.chunkId)))
    const nodeMap = new Map<string, KnowledgeGraphProposalNode>()
    const rawToNodeId = new Map<string, string>()
    const warnings: string[] = Array.isArray(raw?.warnings) && raw.warnings.length > 0 ? ['AI returned graph warnings.'] : []
    let removedEvidence = false
    const normalizeEvidence = (value: unknown) => {
      const rawIds = Array.isArray(value) ? value.map(String) : []
      const valid = uniqueStrings(rawIds.filter((id) => /^[a-f\d]{24}$/i.test(id) && allowedChunkIds.has(id)))
      if (valid.length !== rawIds.length) removedEvidence = true
      return valid
    }

    for (const [index, item] of this.array(raw?.nodes).entries()) {
      const label = String(item?.label || item?.name || '').trim()
      if (!label) continue
      const type = normalizeKnowledgeGraphNodeType(item?.type)
      const id = this.nodeId(label, type)
      const noteIds = normalizeKnowledgeGraphNoteIds(item?.noteIds, allowedNoteIds)
      const confidence = clampUnitInterval(item?.confidence, 0.75)
      const evidenceChunkIds = normalizeEvidence(item?.evidenceChunkIds)
      const existing = nodeMap.get(id)
      if (existing) {
        existing.noteIds = uniqueStrings([...existing.noteIds, ...noteIds])
        existing.confidence = Math.max(existing.confidence, confidence)
        existing.evidenceChunkIds = uniqueStrings([...existing.evidenceChunkIds, ...evidenceChunkIds])
      } else if (nodeMap.size < this.maxNodes) {
        nodeMap.set(id, { id, label, type, confidence, noteIds, evidenceChunkIds })
      }

      const normalizedId = nodeMap.get(id)?.id || id
      rawToNodeId.set(label, normalizedId)
      if (item?.id) rawToNodeId.set(String(item.id), normalizedId)
      rawToNodeId.set(String(index), normalizedId)
    }

    const edgeMap = new Map<string, KnowledgeGraphProposalEdge>()
    for (const item of this.array(raw?.edges)) {
      const source = rawToNodeId.get(String(item?.source || '').trim())
      const target = rawToNodeId.get(String(item?.target || '').trim())
      if (!source || !target || source === target) continue
      const relation = normalizeKnowledgeGraphRelation(item?.relation || item?.label)
      const id = this.edgeId(source, target, relation)
      const sourceNode = nodeMap.get(source)
      const targetNode = nodeMap.get(target)
      const fallbackNoteIds = uniqueStrings([...(sourceNode?.noteIds || []), ...(targetNode?.noteIds || [])])
      const normalizedNoteIds = resolveKnowledgeGraphEdgeNoteIds(item?.noteIds, allowedNoteIds, fallbackNoteIds)
      const weight = clampUnitInterval(item?.weight, 0.6)
      const evidenceChunkIds = normalizeEvidence(item?.evidenceChunkIds)
      const existing = edgeMap.get(id)
      if (existing) {
        existing.noteIds = uniqueStrings([...existing.noteIds, ...normalizedNoteIds])
        existing.weight = Math.max(existing.weight, weight)
        existing.evidenceChunkIds = uniqueStrings([...existing.evidenceChunkIds, ...evidenceChunkIds])
      } else if (edgeMap.size < this.maxEdges) {
        edgeMap.set(id, { id, source, target, relation, weight, noteIds: normalizedNoteIds, evidenceChunkIds })
      }
    }

    if (removedEvidence) warnings.push('Some invalid graph evidence references were removed.')

    return {
      knowledgeBaseId,
      generatedAt: new Date().toISOString(),
      nodes: [...nodeMap.values()],
      edges: [...edgeMap.values()],
      warnings,
    }
  }

  private nodeId(label: string, type: KnowledgeGraphNodeType) {
    return `kg_${type}_${this.slug(label)}`
  }

  private edgeId(source: string, target: string, relation: string) {
    return `kg_edge_${this.slug(source)}_${this.slug(target)}_${this.slug(relation)}`
  }

  private slug(value: string) {
    const ascii = String(value || '')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 80)
    return ascii || Buffer.from(String(value || '')).toString('hex').slice(0, 32) || 'node'
  }

  private array(value: unknown): any[] {
    return Array.isArray(value) ? value : []
  }

  private cleanText(value: unknown) {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#*`_~>\[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private safeDate(value: unknown): string {
    const date = new Date(value as any)
    return Number.isNaN(date.getTime()) ? 'unknown time' : date.toISOString()
  }
}
