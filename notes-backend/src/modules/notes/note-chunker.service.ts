import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'

export interface BuiltNoteChunk {
  chunkIndex: number
  headingPath: string[]
  content: string
  contentHash: string
  tokenCount: number
}

interface MarkdownBlock {
  headingPath: string[]
  content: string
  code: boolean
}

@Injectable()
export class NoteChunkerService {
  private readonly targetTokens = 700
  private readonly hardTokens = 900
  private readonly overlapTokens = 80

  buildChunks(input: { title: string; content: string }): BuiltNoteChunk[] {
    const blocks = this.parseBlocks(String(input.title || '').trim(), String(input.content || ''))
      .flatMap((block) => this.splitOversizedBlock(block))
    const built: Array<{ headingPath: string[]; content: string }> = []
    let current: { headingPath: string[]; content: string; containsCode: boolean } | undefined

    const flush = () => {
      if (!current?.content.trim()) return
      built.push({ headingPath: current.headingPath, content: current.content.trim() })
      current = undefined
    }

    for (const block of blocks) {
      if (!current) {
        current = { headingPath: block.headingPath, content: block.content, containsCode: block.code }
        continue
      }

      const samePath = current.headingPath.join('\u0000') === block.headingPath.join('\u0000')
      const combined = `${current.content}\n\n${block.content}`
      if (samePath && this.estimateTokens(combined) <= this.targetTokens) {
        current.content = combined
        current.containsCode ||= block.code
        continue
      }

      const overlap = current.containsCode ? '' : this.takeTail(current.content, this.overlapTokens)
      flush()
      const content = samePath && overlap ? `${overlap}\n\n${block.content}` : block.content
      current = { headingPath: block.headingPath, content, containsCode: block.code }
    }
    flush()

    return built.map((chunk, chunkIndex) => {
      const tokenCount = this.estimateTokens(chunk.content)
      if (tokenCount > this.hardTokens) {
        throw new Error(`Chunk ${chunkIndex} exceeds ${this.hardTokens} estimated tokens`)
      }
      return {
        chunkIndex,
        headingPath: chunk.headingPath,
        content: chunk.content,
        contentHash: createHash('sha256')
          .update(`${chunk.headingPath.join(' > ')}\n${chunk.content}`)
          .digest('hex'),
        tokenCount,
      }
    })
  }

  estimateTokens(text: string): number {
    let units = 0
    for (const char of text) {
      units += /[\u3400-\u9fff]/.test(char) ? 1 : 0.25
    }
    return Math.ceil(units)
  }

  private parseBlocks(title: string, content: string): MarkdownBlock[] {
    const root = title ? [title] : []
    let headings: string[] = []
    let paragraph: string[] = []
    const blocks: MarkdownBlock[] = []
    const lines = content.replace(/\r\n?/g, '\n').split('\n')

    const path = () => [...root, ...headings]
    const flushParagraph = () => {
      const value = paragraph.join('\n').trim()
      if (value) blocks.push({ headingPath: path(), content: value, code: false })
      paragraph = []
    }

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (heading) {
        flushParagraph()
        const depth = heading[1].length
        headings = [...headings.slice(0, depth - 1), heading[2].trim()]
        continue
      }

      if (/^\s*```/.test(line)) {
        flushParagraph()
        const codeLines = [line]
        while (++index < lines.length) {
          codeLines.push(lines[index])
          if (/^\s*```\s*$/.test(lines[index])) break
        }
        blocks.push({ headingPath: path(), content: codeLines.join('\n').trim(), code: true })
        continue
      }

      if (!line.trim()) {
        flushParagraph()
      } else {
        paragraph.push(line)
      }
    }
    flushParagraph()
    return blocks
  }

  private splitOversizedBlock(block: MarkdownBlock): MarkdownBlock[] {
    if (block.code || this.estimateTokens(block.content) <= this.targetTokens) return [block]

    const parts: MarkdownBlock[] = []
    let remaining = block.content
    while (this.estimateTokens(remaining) > this.targetTokens) {
      let end = 1
      while (end < remaining.length && this.estimateTokens(remaining.slice(0, end + 1)) <= this.targetTokens) end++
      const preferredBreak = Math.max(
        remaining.lastIndexOf('\n', end),
        remaining.lastIndexOf('。', end),
        remaining.lastIndexOf('！', end),
        remaining.lastIndexOf('？', end),
      )
      const cut = preferredBreak > end / 2 ? preferredBreak + 1 : end
      const content = remaining.slice(0, cut).trim()
      parts.push({ ...block, content })
      const overlap = this.takeTail(content, this.overlapTokens)
      remaining = `${overlap}\n${remaining.slice(cut).trimStart()}`
    }
    if (remaining.trim()) parts.push({ ...block, content: remaining.trim() })
    return parts
  }

  private takeTail(text: string, tokenLimit: number): string {
    let start = text.length
    while (start > 0 && this.estimateTokens(text.slice(start - 1)) <= tokenLimit) start--
    return text.slice(start).trim()
  }
}
