import { Controller, Get, Query } from '@nestjs/common'
import { SemanticService } from './semantic.service'

@Controller('v1/semantic')
export class SemanticController {
  constructor(private readonly semantic: SemanticService) { }

  @Get('search')
  async search(
    @Query('q') q: string,
    @Query('mode') mode?: 'keyword' | 'vector' | 'hybrid',
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('threshold') threshold?: number,
    @Query('categoryId') categoryId?: string,
    @Query('tagIds') tagIds?: string | string[],
    @Query('tagsMode') tagsMode?: 'any' | 'all',
    @Query('categoriesMode') categoriesMode?: 'any' | 'all',
  ) {
    const tagArray = Array.isArray(tagIds)
      ? (tagIds as string[]).filter(Boolean)
      : (tagIds ? String(tagIds).split(',').filter(Boolean) : undefined)
    return this.semantic.search(String(q || ''), { mode, page: Number(page || 1), limit: Number(limit || 10), threshold: Number(threshold || 0), categoryId, tagIds: tagArray, tagsMode, categoriesMode })
  }
}
