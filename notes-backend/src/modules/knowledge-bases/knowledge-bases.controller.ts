import { Body, Controller, Delete, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { AddKnowledgeBaseNoteDto, CreateKnowledgeBaseDto, SaveKnowledgeGraphDto } from './dto'
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

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() body: AddKnowledgeBaseNoteDto, @Request() req) {
    return this.service.addNoteFromDto(id, body, req.user.id)
  }

  @Get(':id/notes')
  listNotes(@Param('id') id: string, @Request() req) {
    return this.service.listNotes(id, req.user.id)
  }

  @Get(':id/graph')
  getGraph(@Param('id') id: string, @Request() req) {
    return this.service.getGraph(id, req.user.id)
  }

  @Put(':id/graph')
  replaceGraph(@Param('id') id: string, @Body() body: SaveKnowledgeGraphDto, @Request() req) {
    return this.service.replaceGraph(id, body, req.user.id)
  }

  @Delete(':id/notes/:noteId')
  removeNote(@Param('id') id: string, @Param('noteId') noteId: string, @Request() req) {
    return this.service.removeNote(id, noteId, req.user.id)
  }
}
