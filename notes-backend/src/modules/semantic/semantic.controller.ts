import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common'
import { SemanticService } from './semantic.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('v1/semantic')
@UseGuards(JwtAuthGuard)
export class SemanticController {
  constructor(private readonly semantic: SemanticService) { }

  @Get('search')
  async search(
    @Request() req,
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

    if (mode === 'vector' || mode === 'hybrid') {
      try {
        // Fix: Use req.user._id or req.user.id as the user ID. req.user is the Mongoose document.
        const userObj = req.user as any;
        const userId = userObj._id || userObj.id || userObj.userId;

        if (!userId) {
          console.error('User ID not found in request:', userObj);
          throw new Error('User ID missing');
        }

        const results = await this.semantic.searchVector(String(q || ''), userId);

        // If vector search returns results, use them
        if (results.length > 0) {
          return {
            page: Number(page || 1),
            limit: Number(limit || 10),
            total: results.length, // Vector search aggregation doesn't return total count easily
            totalPages: 1,
            hasNext: false,
            data: results.map(item => ({
              id: item._id,
              title: item.title,
              preview: item.content.substring(0, 200),
              score: item.score,
              updatedAt: item.updatedAt
            }))
          }
        }
      } catch (err) {
        console.error('Vector search failed:', err);
        // Fallthrough to keyword search on error

        // If vector search fails (empty) and mode is hybrid, fallback to keyword search
        if (mode === 'hybrid') {
          return this.semantic.search(String(q || ''), { mode: 'keyword', page: Number(page || 1), limit: Number(limit || 10), threshold: Number(threshold || 0), categoryId, tagIds: tagArray, tagsMode, categoriesMode })
        }

        // If mode is vector and no results, return empty
        return {
          page: Number(page || 1),
          limit: Number(limit || 10),
          total: 0,
          totalPages: 1,
          hasNext: false,
          data: []
        }
      }

      return this.semantic.search(String(q || ''), { mode, page: Number(page || 1), limit: Number(limit || 10), threshold: Number(threshold || 0), categoryId, tagIds: tagArray, tagsMode, categoriesMode })
    }
  }
}