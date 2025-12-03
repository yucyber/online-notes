import { Controller, Get, Post, Param, Body, UseGuards, Request, Query } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { VersionsService } from './versions.service'

@UseGuards(AuthGuard('jwt'))
@Controller('notes/:id/versions')
export class VersionsController {
  constructor(private readonly service: VersionsService) {}

  @Get()
  async list(@Param('id') id: string, @Request() req) {
    return this.service.list(id, req.user.id)
  }

  @Post()
  async snapshot(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { requestId } = body
    return this.service.snapshot(id, req.user.id, requestId)
  }

  @Post(':versionNo/restore')
  async restore(@Param('id') id: string, @Param('versionNo') versionNo: string, @Body() body: any, @Request() req) {
    const { requestId } = body
    return this.service.restore(id, Number(versionNo), req.user.id, requestId)
  }
}
