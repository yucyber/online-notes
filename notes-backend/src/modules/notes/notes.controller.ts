import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotesService } from './notes.service';
import { CreateNoteDto, UpdateNoteDto, NoteFilterDto, RecommendationQueryDto } from './dto';

@UseGuards(AuthGuard('jwt'))
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) { }

  @Post()
  async create(@Body() createNoteDto: CreateNoteDto, @Request() req) {
    return this.notesService.create(createNoteDto, req.user.id);
  }

  @Get()
  async findAll(@Request() req, @Query() filterDto: NoteFilterDto) {
    return this.notesService.findAll(req.user.id, filterDto);
  }

  @Get('recommendations')
  async getRecommendations(
    @Request() req,
    @Query() queryDto: RecommendationQueryDto,
  ) {
    return this.notesService.getRecommendations(
      req.user.id,
      queryDto.currentNoteId,
      queryDto.limit ?? 5,
      queryDto,
    );
  }

  @Get(':noteId/chunks/:chunkId/location')
  async getChunkLocation(
    @Param('noteId') noteId: string,
    @Param('chunkId') chunkId: string,
    @Request() req,
  ) {
    return this.notesService.getChunkLocation(noteId, chunkId, req.user.id);
  }

  @Get(':noteId/chunks/:chunkId/evidence')
  async chunkEvidence(
    @Param('noteId') noteId: string,
    @Param('chunkId') chunkId: string,
    @Request() req,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('heading') heading?: string,
  ) {
    return this.notesService.getChunkEvidence(noteId, chunkId, req.user.id, {
      ...(before !== undefined ? { before: Number(before) } : {}),
      ...(after !== undefined ? { after: Number(after) } : {}),
      ...(heading ? { headingPath: heading.split('>').map((part) => part.trim()).filter(Boolean) } : {}),
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.notesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateNoteDto: UpdateNoteDto, @Request() req) {
    return this.notesService.update(id, updateNoteDto, req.user.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    await this.notesService.remove(id, req.user.id);
    return { message: '笔记删除成功' };
  }
  @Get(':id/acl')
  async getAcl(@Param('id') id: string, @Request() req) {
    return this.notesService.getAcl(id, req.user.id)
  }

  @Patch(':id/acl/:userId')
  async updateCollaboratorRole(@Param('id') id: string, @Param('userId') userId: string, @Body() body: any, @Request() req) {
    const { role } = body
    return this.notesService.updateCollaboratorRole(id, req.user.id, userId, role)
  }

  @Delete(':id/acl/:userId')
  async removeCollaborator(@Param('id') id: string, @Param('userId') userId: string, @Request() req) {
    return this.notesService.removeCollaborator(id, req.user.id, userId)
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/room-ticket')
  async generateRoomTicket(@Param('id') id: string, @Request() req) {
    return this.notesService.generateRoomTicket(id, req.user.id);
  }
}
