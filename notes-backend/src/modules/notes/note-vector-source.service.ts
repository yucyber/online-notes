import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'

export interface NoteTopicVectorSourceInput {
  title: string
  summary: string
  categoryName?: string
  tagNames?: string[]
}

@Injectable()
export class NoteVectorSourceService {
  buildTopicVectorSource(input: NoteTopicVectorSourceInput): string {
    const tags = [...new Set((input.tagNames || []).map((value) => value.trim()).filter(Boolean))]
      .sort()

    return [
      `标题：${String(input.title || '').trim()}`,
      `摘要：${String(input.summary || '').trim()}`,
      input.categoryName?.trim() ? `分类：${input.categoryName.trim()}` : '',
      tags.length > 0 ? `标签：${tags.join('、')}` : '',
    ].filter(Boolean).join('\n')
  }

  hashTopicVectorSource(source: string): string {
    return createHash('sha256').update(source).digest('hex')
  }
}
