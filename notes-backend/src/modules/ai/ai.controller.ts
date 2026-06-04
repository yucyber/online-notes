import { BadRequestException, Body, Controller, Post, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Response } from 'express'
import { AiService } from './ai.service'
import { AiMermaidInput, AiMindmapInput, AiPetInput, AiWriterInput } from './ai-gateway.types'

@UseGuards(AuthGuard('jwt'))
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('writer')
  async generateWriter(@Body() body: AiWriterInput) {
    return { text: await this.aiService.generateWriterText(body) }
  }

  @Post('writer/stream')
  async streamWriter(@Body() body: AiWriterInput, @Res() res: Response) {
    const stream = await this.aiService.streamWriter(body)
    return this.writeTextStream(stream, res)
  }

  @Post('mindmap')
  async generateMindmap(@Body() body: AiMindmapInput) {
    return this.aiService.generateMindmap(body)
  }

  @Post('mermaid')
  async generateMermaid(@Body() body: AiMermaidInput) {
    return this.aiService.generateMermaid(body)
  }

  @Post('pet')
  async chatPet(@Body() body: AiPetInput & { image?: unknown }, @Res() res: Response) {
    if ((body as any).image) {
      throw new BadRequestException('Image chat is not supported by the current AI provider route.')
    }

    const stream = await this.aiService.chatPet(body)
    return this.writeTextStream(stream, res)
  }

  @Post('summary')
  async generateSummary(@Body() body: { notes: any[] }) {
    if (!Array.isArray(body?.notes) || body.notes.length === 0) {
      throw new BadRequestException('Please provide at least one note.')
    }

    return this.aiService.generateAggregateSummary(body.notes)
  }

  private async writeTextStream(stream: ReadableStream<Uint8Array>, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) res.write(Buffer.from(value))
      }
    } finally {
      res.end()
    }
  }
}
