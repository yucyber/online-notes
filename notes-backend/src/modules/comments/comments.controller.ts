import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { CommentsService } from './comments.service'

@UseGuards(AuthGuard('jwt'))
@Controller('notes/:id/comments')
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  @Get()
  async list(@Param('id') id: string, @Request() req) {
    const data = await this.service.list(id, req.user.id)
    const rid = (req.headers['x-request-id'] as string) || undefined
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }

  @Post()
  async create(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { start, end, text } = body
    const rid = (req.headers['x-request-id'] as string) || undefined
    const data = await this.service.create(id, req.user.id, Number(start), Number(end), String(text || ''), rid)
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('comments')
export class CommentRepliesController {
  constructor(private readonly service: CommentsService) {}
  @Post(':id/replies')
  async reply(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { text } = body
    const rid = (req.headers['x-request-id'] as string) || undefined
    const data = await this.service.reply(id, req.user.id, String(text || ''), rid)
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    const rid = (req.headers['x-request-id'] as string) || undefined
    const data = await this.service.remove(id, req.user.id, rid)
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }
}
