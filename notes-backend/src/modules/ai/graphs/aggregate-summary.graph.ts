import { Injectable } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { AiWorkflowContext } from '../ai-gateway.types'

export interface AggregateSummaryGraphOptions {
  maxChunkChars?: number
  maxNotes?: number
  maxNoteChars?: number
}

interface PreparedNote {
  title: string
  updatedAt: string
  content: string
  formatted: string
}

@Injectable()
export class AggregateSummaryGraph {
  private readonly maxChunkChars: number
  private readonly maxNotes: number
  private readonly maxNoteChars: number

  constructor(
    private readonly gateway: AiGatewayClient,
    options: AggregateSummaryGraphOptions = {},
  ) {
    this.maxChunkChars = options.maxChunkChars || 10000
    this.maxNotes = options.maxNotes || 50
    this.maxNoteChars = options.maxNoteChars || 2000
  }

  async run(notes: any[], context?: AiWorkflowContext): Promise<string> {
    const prepared = this.prepareNotes(notes)
    if (prepared.length === 0) return ''

    const chunks = this.chunkNotes(prepared)
    if (chunks.length === 1) {
      return this.normalizeSummary(await this.synthesizeNotes(chunks[0], prepared.length, context))
    }

    const partials: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      partials.push(this.normalizeSummary(await this.summarizeChunk(chunks[index], index, chunks.length, context)))
    }

    return this.normalizeSummary(await this.synthesizePartials(partials, prepared.length, context))
  }

  private prepareNotes(notes: any[]): PreparedNote[] {
    return (Array.isArray(notes) ? notes : [])
      .slice(0, this.maxNotes)
      .map((note, index) => {
        const title = String(note?.title || `Note ${index + 1}`).trim()
        const updatedAt = note?.updatedAt ? this.safeDate(note.updatedAt) : 'unknown time'
        const content = this.cleanText(String(note?.content || '')).slice(0, this.maxNoteChars)
        return {
          title,
          updatedAt,
          content,
          formatted: `Title: ${title}\nUpdated: ${updatedAt}\nContent:\n${content}`,
        }
      })
      .filter((note) => note.title || note.content)
  }

  private chunkNotes(notes: PreparedNote[]): PreparedNote[][] {
    const chunks: PreparedNote[][] = []
    let current: PreparedNote[] = []
    let currentLength = 0

    for (const note of notes) {
      const nextLength = currentLength + note.formatted.length
      if (current.length > 0 && nextLength > this.maxChunkChars) {
        chunks.push(current)
        current = []
        currentLength = 0
      }

      current.push(note)
      currentLength += note.formatted.length
    }

    if (current.length > 0) chunks.push(current)
    return chunks
  }

  private summarizeChunk(chunk: PreparedNote[], index: number, total: number, context?: AiWorkflowContext): Promise<string> {
    return this.gateway.chatTask({
      task: 'aggregate_summary',
      system: 'You summarize subsets of selected notes for a later synthesis step.',
      prompt: [
        `Summarize this subset of selected notes (${index + 1}/${total}).`,
        'Return concise Chinese Markdown with key points, decisions, risks, and next actions when applicable.',
        'Do not mention that you are an AI.',
        '',
        this.formatChunk(chunk),
      ].join('\n'),
      maxTokens: 1000,
      temperature: 0.25,
      audit: { graphName: 'AggregateSummaryGraph', userId: context?.userId },
    }).then(result => result.content)
  }

  private synthesizeNotes(chunk: PreparedNote[], totalNotes: number, context?: AiWorkflowContext): Promise<string> {
    return this.gateway.chatTask({
      task: 'aggregate_summary',
      system: 'You write concise synthesis summaries for selected notes.',
      prompt: [
        `Create a structured Chinese summary for these ${totalNotes} selected notes.`,
        'Return readable Markdown with sections for key points, decisions, risks, and next actions when applicable.',
        'Do not mention that you are an AI.',
        '',
        this.formatChunk(chunk),
      ].join('\n'),
      maxTokens: 1600,
      temperature: 0.3,
      audit: { graphName: 'AggregateSummaryGraph', userId: context?.userId },
    }).then(result => result.content)
  }

  private synthesizePartials(partials: string[], totalNotes: number, context?: AiWorkflowContext): Promise<string> {
    return this.gateway.chatTask({
      task: 'aggregate_summary',
      system: 'You synthesize partial summaries into one final note summary.',
      prompt: [
        `Create one structured Chinese summary for ${totalNotes} selected notes based on these partial summaries.`,
        'Return readable Markdown with sections for key points, decisions, risks, and next actions when applicable.',
        'Remove duplicate points and keep the final answer concise.',
        'Do not mention that you are an AI.',
        '',
        partials.map((summary, index) => `Partial ${index + 1}:\n${summary}`).join('\n\n---\n\n'),
      ].join('\n'),
      maxTokens: 1800,
      temperature: 0.25,
      audit: { graphName: 'AggregateSummaryGraph', userId: context?.userId },
    }).then(result => result.content)
  }

  private formatChunk(chunk: PreparedNote[]): string {
    return chunk.map((note) => note.formatted).join('\n\n---\n\n')
  }

  private normalizeSummary(summary: string): string {
    const normalized = String(summary || '').trim()
    if (!normalized) throw new Error('AI aggregate summary output is empty.')
    return normalized
  }

  private cleanText(content: string): string {
    return String(content || '')
      .replace(/<[^>]+>/g, '')
      .replace(/[#*`_~>\[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private safeDate(value: unknown): string {
    const date = new Date(value as any)
    return Number.isNaN(date.getTime()) ? 'unknown time' : date.toISOString()
  }
}
