import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { CommentsService } from './comments.service'

@UseGuards(AuthGuard('jwt'))
@Controller('notes/:id/comments')
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  @Get()
  async list(@Param('id') id: string, @Request() req) {
    return this.service.list(id, req.user.id)
  }

  @Post()
  async create(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { start, end, text } = body
    return this.service.create(id, req.user.id, Number(start), Number(end), String(text || ''))
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('comments')
export class CommentRepliesController {
  constructor(private readonly service: CommentsService) {}
  @Post(':id/replies')
  async reply(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { text } = body
    return this.service.reply(id, req.user.id, String(text || ''))
  }
}
