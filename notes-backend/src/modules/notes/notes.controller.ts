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
import { Headers, Res } from '@nestjs/common';
import type { Response } from 'express'
import { createHash } from 'crypto'

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
  async findOne(@Param('id') id: string, @Request() req, @Res({ passthrough: true }) res: Response) {
    const note = await this.notesService.findOne(id, req.user.id);
    const etag = this.computeETag(note)
    res.setHeader('ETag', etag)
    const inm = (req.headers?.['if-none-match'] as string) || undefined
    if (inm && inm === etag) {
      // 条件GET命中，返回304（由异常过滤器/包拦截器跳过）
      res.status(304)
      return undefined
    }
    return note
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateNoteDto: UpdateNoteDto,
    @Request() req,
    @Headers('If-Match') ifMatch?: string,
  ) {
    // 条件更新：校验 If-Match 与当前资源 ETag
    if (ifMatch) {
      const current = await this.notesService.findOne(id, req.user.id)
      const currentEtag = this.computeETag(current)
      if (ifMatch !== currentEtag) {
        const { HttpException, HttpStatus } = require('@nestjs/common')
        throw new HttpException('ETag mismatch', HttpStatus.PRECONDITION_FAILED)
      }
    }
    const updated = await this.notesService.update(id, updateNoteDto, req.user.id);
    return updated
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    await this.notesService.remove(id, req.user.id);
    return { message: '笔记删除成功' };
  }
  @Put(':id')
  async updateAll(@Param('id') id: string, @Body() updateNoteDto: UpdateNoteDto, @Request() req, @Headers('If-Match') ifMatch?: string) {
    if (ifMatch) {
      const current = await this.notesService.findOne(id, req.user.id)
      const currentEtag = this.computeETag(current)
      if (ifMatch !== currentEtag) {
        const { HttpException, HttpStatus } = require('@nestjs/common')
        throw new HttpException('ETag mismatch', HttpStatus.PRECONDITION_FAILED)
      }
    }
    return this.notesService.update(id, updateNoteDto, req.user.id);
  }

  @Get(':id/acl')
  async getAcl(@Param('id') id: string, @Request() req) {
    return this.notesService.getAcl(id, req.user.id)
  }

  @Post(':id/acl')
  async addCollaborator(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { userId, role } = body
    return this.notesService.addCollaborator(id, req.user.id, userId, role)
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

  @Post(':id/lock')
  async lock(@Param('id') id: string, @Request() req) {
    return this.notesService.lockNote(id, req.user.id)
  }

  @Delete(':id/lock')
  async unlock(@Param('id') id: string, @Request() req) {
    return this.notesService.unlockNote(id, req.user.id)
  }

  private computeETag(note: any): string {
    const basis = `${note?.id || note?._id || ''}:${new Date(note?.updatedAt || Date.now()).getTime()}`
    const hash = createHash('sha1').update(basis).digest('hex')
    return `W/"${hash}"`
  }
}
