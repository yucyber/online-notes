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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TagsService } from './tags.service';
import { CreateTagDto, UpdateTagDto } from './dto';
import { Query } from '@nestjs/common';

@UseGuards(AuthGuard('jwt'))
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) { }

  @Post('sync')
  async syncCounts(@Request() req) {
    return this.tagsService.syncCounts(req.user.id);
  }

  @Post()
  async create(@Body() createTagDto: CreateTagDto, @Request() req) {
    return this.tagsService.create(createTagDto, req.user.id);
  }

  @Get()
  async findAll(@Request() req) {
    return this.tagsService.findAll(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.tagsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateTagDto: UpdateTagDto,
    @Request() req,
  ) {
    return this.tagsService.update(id, updateTagDto, req.user.id);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Request() req,
    @Query('mode') mode?: 'remove' | 'reassign',
    @Query('targetId') targetId?: string,
  ) {
    // 默认策略：移除模式
    if (mode === 'reassign' && targetId) {
      await this.tagsService.merge([id], targetId, req.user.id);
    } else {
      await this.tagsService.remove(id, req.user.id);
    }
    return { message: '标签删除成功' };
  }

  @Post('bulk')
  async bulkCreate(@Body('names') names: string[], @Request() req) {
    return this.tagsService.bulkCreate(names || [], req.user.id)
  }

  @Post('merge')
  async merge(@Body() payload: { sourceIds: string[]; targetId: string }, @Request() req) {
    const { sourceIds, targetId } = payload || {}
    return this.tagsService.merge(sourceIds || [], targetId, req.user.id)
  }
}
