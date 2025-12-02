import {
  Put,
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
import { CreateNoteDto, UpdateNoteDto, NoteFilterDto } from './dto';

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
    @Query('currentNoteId') currentNoteId?: string,
    @Query('limit') limit: number = 5,
    @Query() filterDto?: NoteFilterDto,
  ) {
    return this.notesService.getRecommendations(req.user.id, currentNoteId, limit, filterDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.notesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateNoteDto: UpdateNoteDto,
    @Request() req,
  ) {
    return this.notesService.update(id, updateNoteDto, req.user.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    await this.notesService.remove(id, req.user.id);
    return { message: '笔记删除成功' };
  }
  @Put(':id')
  async updateAll(@Param('id') id: string, @Body() updateNoteDto: UpdateNoteDto, @Request() req) {
    return this.notesService.update(id, updateNoteDto, req.user.id);
  }
}
