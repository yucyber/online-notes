import { BadRequestException, Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Request, Response } from 'express'
import { AiService } from './ai.service'
import { AiKnowledgeGraphInput, AiMermaidInput, AiMindmapInput, AiPetInput, AiWriterInput } from './ai-gateway.types'

type AuthenticatedRequest = Request & {
  user?: {
    id?: string
    _id?: string
    userId?: string
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('writer')
  async generateWriter(@Body() body: AiWriterInput, @Req() req?: AuthenticatedRequest) {
    return { text: await this.aiService.generateWriterText(body, this.aiContext(req)) }
  }

  @Post('writer/stream')
  async streamWriter(@Body() body: AiWriterInput, @Res() res: Response, @Req() req?: AuthenticatedRequest) {
    const stream = await this.aiService.streamWriter(body, this.aiContext(req))
    return this.writeTextStream(stream, res)
  }

  @Post('mindmap')
  async generateMindmap(@Body() body: AiMindmapInput, @Req() req?: AuthenticatedRequest) {
    return this.aiService.generateMindmap(body, this.aiContext(req))
  }

  @Post('mermaid')
  async generateMermaid(@Body() body: AiMermaidInput, @Req() req?: AuthenticatedRequest) {
    return this.aiService.generateMermaid(body, this.aiContext(req))
  }

  @Post('knowledge-graph/proposal')
  async buildKnowledgeGraphProposal(@Body() body: AiKnowledgeGraphInput, @Req() req?: AuthenticatedRequest) {
    return this.aiService.buildKnowledgeGraphProposal(body?.knowledgeBaseId, this.aiContext(req))
  }

  @Post('pet')
  async chatPet(@Body() body: AiPetInput & { image?: unknown }, @Res() res: Response, @Req() req?: AuthenticatedRequest) {
    if ((body as any).image) {
      throw new BadRequestException('Image chat is not supported by the current AI provider route.')
    }

    const stream = await this.aiService.chatPet(body, this.aiContext(req))
    return this.writeTextStream(stream, res)
  }

  @Post('summary')
  async generateSummary(@Body() body: { notes: any[] }, @Req() req?: AuthenticatedRequest) {
    if (!Array.isArray(body?.notes) || body.notes.length === 0) {
      throw new BadRequestException('Please provide at least one note.')
    }

    return this.aiService.generateAggregateSummary(body.notes, this.aiContext(req))
  }

  private aiContext(req?: AuthenticatedRequest) {
    return {
      userId: this.userId(req),
    }
  }

  private userId(req?: AuthenticatedRequest): string | undefined {
    const user = req?.user
    return user?.id || user?._id || user?.userId
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
