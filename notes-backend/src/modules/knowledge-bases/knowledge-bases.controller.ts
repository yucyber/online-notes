import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { AddKnowledgeBaseNoteDto, CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from './dto'
import { KnowledgeBasesService } from './knowledge-bases.service'

@UseGuards(AuthGuard('jwt'))
@Controller('knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly service: KnowledgeBasesService) {}

  @Post()
  create(@Body() body: CreateKnowledgeBaseDto, @Request() req) {
    return this.service.create(body, req.user.id)
  }

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user.id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateKnowledgeBaseDto, @Request() req) {
    return this.service.update(id, body, req.user.id)
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id)
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() body: AddKnowledgeBaseNoteDto, @Request() req) {
    return this.service.addNoteFromDto(id, body, req.user.id)
  }

  @Get(':id/notes')
  listNotes(@Param('id') id: string, @Request() req) {
    return this.service.listNotes(id, req.user.id)
  }

  @Delete(':id/notes/:noteId')
  removeNote(@Param('id') id: string, @Param('noteId') noteId: string, @Request() req) {
    return this.service.removeNote(id, noteId, req.user.id)
  }
}
