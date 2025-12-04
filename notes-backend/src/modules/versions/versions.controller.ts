import { Controller, Get, Post, Param, Body, UseGuards, Request, Query } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { VersionsService } from './versions.service'

@UseGuards(AuthGuard('jwt'))
@Controller('notes/:id/versions')
export class VersionsController {
  constructor(private readonly service: VersionsService) {}

  @Get()
  async list(@Param('id') id: string, @Request() req) {
    const data = await this.service.list(id, req.user.id)
    const rid = (req.headers['x-request-id'] as string) || undefined
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }

  @Post()
  async snapshot(@Param('id') id: string, @Body() body: any, @Request() req) {
    const headerRid = (req.headers['x-request-id'] as string) || undefined
    const rid = body?.requestId || headerRid
    const data = await this.service.snapshot(id, req.user.id, rid)
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }

  @Post(':versionNo/restore')
  async restore(@Param('id') id: string, @Param('versionNo') versionNo: string, @Body() body: any, @Request() req) {
    const headerRid = (req.headers['x-request-id'] as string) || undefined
    const rid = body?.requestId || headerRid
    const data = await this.service.restore(id, Number(versionNo), req.user.id, rid)
    return { code: 0, message: 'OK', data, requestId: rid, timestamp: Date.now() }
  }
}
