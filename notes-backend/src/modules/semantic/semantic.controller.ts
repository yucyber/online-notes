import { Controller, Get, Post, Body, Query, UseGuards, Request, UnauthorizedException } from '@nestjs/common'
import { SemanticService, SemanticSearchOpts } from './semantic.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('v1/semantic')
@UseGuards(JwtAuthGuard)
export class SemanticController {
  constructor(private readonly semantic: SemanticService) { }

  private resolveUserId(req: any): string {
    const userObj = req.user as any
    const userId = userObj?._id || userObj?.id || userObj?.userId
    if (!userId) throw new UnauthorizedException('User ID missing')
    return String(userId)
  }

  private keywordOpts(input: {
    page?: number
    limit?: number
    categoryId?: string
    tagIds?: string[]
    mode?: SemanticSearchOpts['mode']
  }): SemanticSearchOpts {
    return {
      mode: input.mode || 'keyword',
      page: Number(input.page || 1),
      limit: Number(input.limit || 10),
      categoryId: input.categoryId,
      tagIds: input.tagIds,
    }
  }

  @Post('topics/convert')
  async convertTopicToTag(@Request() req, @Body() body: { topicName: string; noteIds: string[] }) {
    const userId = this.resolveUserId(req)
    return this.semantic.convertToTag(userId, body.topicName, body.noteIds);
  }

  @Get('search')
  async search(
    @Request() req,
    @Query('q') q: string,
    @Query('mode') mode?: 'keyword' | 'vector' | 'hybrid',
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('categoryId') categoryId?: string,
    @Query('tagIds') tagIds?: string | string[],
  ) {
    const userId = this.resolveUserId(req)
    const tagArray = Array.isArray(tagIds)
      ? (tagIds as string[]).filter(Boolean)
      : (tagIds ? String(tagIds).split(',').filter(Boolean) : undefined)

    const baseOpts = this.keywordOpts({
      page,
      limit,
      categoryId,
      tagIds: tagArray,
      mode: mode || 'keyword',
    })

    if (mode === 'vector' || mode === 'hybrid') {
      try {
        const results = mode === 'hybrid'
          ? await this.semantic.searchHybrid(String(q || ''), userId, baseOpts)
          : await this.semantic.searchVector(String(q || ''), userId, baseOpts);

        if (results.data.length > 0) {
          return results
        }
      } catch (err) {
        console.error('Vector search failed:', err);
        if (mode === 'hybrid') {
          return this.semantic.search(String(q || ''), userId, { ...baseOpts, mode: 'keyword' })
        }

        return {
          page: Number(page || 1),
          limit: Number(limit || 10),
          total: 0,
          totalPages: 1,
          hasNext: false,
          data: [],
        }
      }

      // Empty vector hit: fall back to access-scoped keyword (same as previous behavior).
      return this.semantic.search(String(q || ''), userId, { ...baseOpts, mode: 'keyword' })
    }

    return this.semantic.search(String(q || ''), userId, baseOpts)
  }

  @Get('topics')
  async getTopics(@Request() req) {
    const userId = this.resolveUserId(req);
    const topics = await this.semantic.discoverTopics(userId);
    return { topics };
  }
}
