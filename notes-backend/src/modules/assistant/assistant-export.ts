import { RagCitation } from '../ai/rag/rag.types'

export function buildExportLines(conversation: { id: string; title: string; createdAt: string }, messages: Array<{ seq: number; role: string; route: string; content: string; status: string; citations: RagCitation[]; createdAt: string }>): string[] {
  const lines: string[] = []
  lines.push(JSON.stringify({ type: 'conversation', id: conversation.id, title: conversation.title, createdAt: conversation.createdAt }))
  for (const message of messages) {
    lines.push(JSON.stringify({ type: 'message', seq: message.seq, role: message.role, route: message.route, content: message.content, status: message.status, createdAt: message.createdAt }))
    for (const citation of message.citations) {
      lines.push(JSON.stringify({ type: 'citation', messageSeq: message.seq, evidenceId: citation.evidenceId, noteId: citation.noteId, chunkId: citation.chunkId, headingPath: citation.headingPath }))
    }
  }
  return lines
}
