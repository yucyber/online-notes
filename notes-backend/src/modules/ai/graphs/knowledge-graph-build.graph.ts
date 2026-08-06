import { Injectable } from '@nestjs/common'
import {
  clampUnitInterval,
  normalizeKnowledgeGraphNodeType,
  normalizeKnowledgeGraphNoteIds,
  resolveKnowledgeGraphEdgeNoteIds,
  uniqueStrings,
  type KnowledgeGraphNodeType,
} from '../../knowledge-bases/knowledge-graph-normalize'
import { AiGatewayClient } from '../ai-gateway.client'
import { parseJsonObject } from '../ai-output'

export type { KnowledgeGraphNodeType }

export interface KnowledgeGraphBuildInput {
  knowledgeBaseId: string
  notes: Array<{
    id: string
    title?: string
    summary?: string
    content?: string
    updatedAt?: string
  }>
}

export interface KnowledgeGraphProposalNode {
  id: string
  label: string
  type: KnowledgeGraphNodeType
  confidence: number
  noteIds: string[]
}

export interface KnowledgeGraphProposalEdge {
  id: string
  source: string
  target: string
  relation: string
  weight: number
  noteIds: string[]
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
}

type PreparedGraphNote = Required<Pick<KnowledgeGraphBuildInput['notes'][number], 'id' | 'title' | 'summary' | 'content' | 'updatedAt'>>

@Injectable()
export class KnowledgeGraphBuildGraph {
  private readonly maxNotes: number
  private readonly maxNoteChars: number
  private readonly maxNodes: number
  private readonly maxEdges: number

  constructor(
    private readonly gateway: AiGatewayClient,
    options: KnowledgeGraphBuildGraphOptions = {},
  ) {
    this.maxNotes = options.maxNotes || 40
    this.maxNoteChars = options.maxNoteChars || 1600
    this.maxNodes = options.maxNodes || 40
    this.maxEdges = options.maxEdges || 80
  }

  async run(input: KnowledgeGraphBuildInput): Promise<KnowledgeGraphProposal> {
    const knowledgeBaseId = String(input?.knowledgeBaseId || '').trim()
    const notes = this.prepareNotes(input?.notes || [])
    if (!knowledgeBaseId) throw new Error('knowledgeBaseId is required.')

    if (notes.length === 0) {
      return {
        knowledgeBaseId,
        generatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
        warnings: ['No readable notes found in this knowledge base.'],
      }
    }

    const answer = await this.gateway.chat({
      route: 'reasoning',
      system: 'You extract knowledge graph proposals for a notes knowledge base. Return JSON only.',
      prompt: this.buildPrompt(knowledgeBaseId, notes),
      maxTokens: 2400,
      temperature: 0.2,
    })

    return this.normalizeProposal(knowledgeBaseId, notes, parseJsonObject(answer))
  }

  private prepareNotes(notes: KnowledgeGraphBuildInput['notes']): PreparedGraphNote[] {
    return (Array.isArray(notes) ? notes : [])
      .slice(0, this.maxNotes)
      .map((note, index) => {
        const id = String(note?.id || '').trim()
        const title = String(note?.title || `Note ${index + 1}`).trim()
        const summary = this.cleanText(note?.summary || '').slice(0, 800)
        const content = this.cleanText(note?.content || '').slice(0, this.maxNoteChars)
        const updatedAt = note?.updatedAt ? this.safeDate(note.updatedAt) : 'unknown time'
        return { id, title, summary, content, updatedAt }
      })
      .filter((note) => note.id && (note.title || note.summary || note.content))
  }

  private buildPrompt(knowledgeBaseId: string, notes: PreparedGraphNote[]) {
    return [
      `Knowledge base: ${knowledgeBaseId}`,
      'Extract a knowledge graph proposal from ONLY the notes listed below.',
      'Return strict JSON with this shape:',
      '{"nodes":[{"label":"string","type":"concept|entity|topic|claim","noteIds":["note id"],"confidence":0.0}],"edges":[{"source":"node label","target":"node label","relation":"string","noteIds":["note id"],"weight":0.0}],"warnings":["string"]}',
      'Do not include noteIds that are not present in the input. Do not write or mutate any source data.',
      'Prefer concise labels and explanatory relation names.',
      '',
      notes.map((note) => [
        `Note ID: ${note.id}`,
        `Title: ${note.title}`,
        `Updated: ${note.updatedAt}`,
        note.summary ? `Summary: ${note.summary}` : '',
        `Content: ${note.content}`,
      ].filter(Boolean).join('\n')).join('\n\n---\n\n'),
    ].join('\n')
  }

  private normalizeProposal(knowledgeBaseId: string, notes: PreparedGraphNote[], raw: any): KnowledgeGraphProposal {
    const allowedNoteIds = new Set(notes.map((note) => note.id))
    const nodeMap = new Map<string, KnowledgeGraphProposalNode>()
    const rawToNodeId = new Map<string, string>()
    const warnings = Array.isArray(raw?.warnings) ? raw.warnings.map((value: unknown) => String(value || '').trim()).filter(Boolean) : []

    for (const [index, item] of this.array(raw?.nodes).entries()) {
      const label = String(item?.label || item?.name || '').trim()
      if (!label) continue
      const type = normalizeKnowledgeGraphNodeType(item?.type)
      const id = this.nodeId(label, type)
      const noteIds = normalizeKnowledgeGraphNoteIds(item?.noteIds, allowedNoteIds)
      const confidence = clampUnitInterval(item?.confidence, 0.75)
      const existing = nodeMap.get(id)
      if (existing) {
        existing.noteIds = uniqueStrings([...existing.noteIds, ...noteIds])
        existing.confidence = Math.max(existing.confidence, confidence)
      } else if (nodeMap.size < this.maxNodes) {
        nodeMap.set(id, { id, label, type, confidence, noteIds })
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
      const relation = String(item?.relation || item?.label || 'related to').trim().slice(0, 120) || 'related to'
      const id = this.edgeId(source, target, relation)
      const sourceNode = nodeMap.get(source)
      const targetNode = nodeMap.get(target)
      const fallbackNoteIds = uniqueStrings([...(sourceNode?.noteIds || []), ...(targetNode?.noteIds || [])])
      const normalizedNoteIds = resolveKnowledgeGraphEdgeNoteIds(item?.noteIds, allowedNoteIds, fallbackNoteIds)
      const weight = clampUnitInterval(item?.weight, 0.6)
      const existing = edgeMap.get(id)
      if (existing) {
        existing.noteIds = uniqueStrings([...existing.noteIds, ...normalizedNoteIds])
        existing.weight = Math.max(existing.weight, weight)
      } else if (edgeMap.size < this.maxEdges) {
        edgeMap.set(id, { id, source, target, relation, weight, noteIds: normalizedNoteIds })
      }
    }

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
