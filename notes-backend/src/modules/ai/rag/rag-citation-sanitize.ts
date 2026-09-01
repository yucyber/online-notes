import { RagCitation, RagEvidence } from './rag.types'

export interface RagCitationSanitizer {
  push(chunk: string): string
  flush(): string
  readonly citations: RagCitation[]
  readonly invalidReferenceFound: boolean
}

// 流式处理：缓冲可能被拆分的 `[E...` 前缀，闭合后再判定是否属于 allowed。
export function createRagCitationSanitizer(allowed: RagEvidence[]): RagCitationSanitizer {
  const byId = new Map(allowed.map((item) => [`E${allowed.indexOf(item) + 1}`, item]))
  const seen = new Set<string>()
  const citations: RagCitation[] = []
  let invalidReferenceFound = false
  let buffer = ''

  const emit = (text: string): string => {
    const cleaned = text.replace(/\[(E\d+)\]/g, (marker, id: string) => {
      const item = byId.get(id)
      if (!item) { invalidReferenceFound = true; return '' }
      if (!seen.has(id)) {
        seen.add(id)
        citations.push({ evidenceId: id, noteId: item.noteId, noteTitle: item.noteTitle, chunkId: item.chunkId, headingPath: item.headingPath, excerpt: item.excerpt, score: item.score })
      }
      return marker
    })
    return cleaned
  }

  return {
    push(chunk: string): string {
      const combined = buffer + chunk
      const lastOpen = combined.lastIndexOf('[')
      if (lastOpen === -1) { buffer = ''; return emit(combined) }
      const tail = combined.slice(lastOpen)
      // `[` 与 `E` 可能被拆到相邻 chunk，单个 `[` 也须缓冲，闭合后才判定。
      if (/^\[E?\d*$/.test(tail)) { buffer = tail; return emit(combined.slice(0, lastOpen)) }
      buffer = ''
      return emit(combined)
    },
    flush(): string { const rest = buffer; buffer = ''; return emit(rest) },
    get citations() { return citations },
    get invalidReferenceFound() { return invalidReferenceFound },
  }
}

// 同步版：供一次性 answer 路径复用；行为与历史 sanitizeCitations 一致。
export function sanitizeCitationText(answer: string, allowed: RagEvidence[]): { answer: string; citations: RagCitation[]; invalidReferenceFound: boolean } {
  const sanitizer = createRagCitationSanitizer(allowed)
  const cleaned = sanitizer.push(answer) + sanitizer.flush()
  return { answer: cleaned.replace(/[ \t]{2,}/g, ' ').trim(), citations: sanitizer.citations, invalidReferenceFound: sanitizer.invalidReferenceFound }
}
