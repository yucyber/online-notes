import { Controller, Post, Get, Put, Body, Param, UseGuards, Req } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { BoardsService } from './boards.service'

@UseGuards(AuthGuard('jwt'))
@Controller('v1/boards')
export class BoardsController {
  constructor(private readonly svc: BoardsService) { }

  @Post()
  async create(@Req() req: any, @Body() payload: { title: string; noteId?: string; content?: any; _id?: string }) {
    return await this.svc.create({
      title: String(payload.title || ''),
      noteId: payload.noteId,
      userId: req.user.id,
      content: payload.content,
      _id: payload._id
    })
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return await this.svc.getById(id)
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() payload: { title?: string; content?: any }) {
    return await this.svc.update(id, payload)
  }
}

