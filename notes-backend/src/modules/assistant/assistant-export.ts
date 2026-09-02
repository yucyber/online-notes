import { RagCitation } from '../ai/rag/rag.types'

// 导出为机器消费边界：时间统一归一化为 ISO 8601。service 层 Date 值经 String() 会产生
// 本地化格式（"Tue Sep 01 2026 10:00:00 GMT+0800 (中国标准时间)"），对严格 ISO 解析器不友好；
// 此处 new Date(...).toISOString() 对已是 ISO 的输入幂等，对本地化串统一转标准 UTC。
function isoDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString()
}

export function buildExportLines(conversation: { id: string; title: string; createdAt: string }, messages: Array<{ seq: number; role: string; route: string; content: string; status: string; citations: RagCitation[]; createdAt: string }>): string[] {
  const lines: string[] = []
  lines.push(JSON.stringify({ type: 'conversation', id: conversation.id, title: conversation.title, createdAt: isoDate(conversation.createdAt) }))
  for (const message of messages) {
    lines.push(JSON.stringify({ type: 'message', seq: message.seq, role: message.role, route: message.route, content: message.content, status: message.status, createdAt: isoDate(message.createdAt) }))
    for (const citation of message.citations) {
      lines.push(JSON.stringify({ type: 'citation', messageSeq: message.seq, evidenceId: citation.evidenceId, noteId: citation.noteId, chunkId: citation.chunkId, headingPath: citation.headingPath }))
    }
  }
  return lines
}
