import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SavedFiltersService } from './saved-filters.service';
import { CreateSavedFilterDto } from './dto';

@UseGuards(AuthGuard('jwt'))
@Controller('saved-filters')
export class SavedFiltersController {
  constructor(private readonly savedFiltersService: SavedFiltersService) {}

  @Post()
  create(@Body() createDto: CreateSavedFilterDto, @Request() req) {
    return this.savedFiltersService.create(createDto, req.user.id);
  }

  @Get()
  findAll(@Request() req) {
    return this.savedFiltersService.findAll(req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.savedFiltersService.remove(id, req.user.id);
  }
}
