import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { AuditService } from './audit.service'

@UseGuards(AuthGuard('jwt'))
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}
  @Get('logs')
  async list(@Query() q: any, @Request() req) {
    const prefixes = Array.isArray(q.eventTypePrefixes) ? q.eventTypePrefixes : (q.eventTypePrefixes ? [q.eventTypePrefixes] : undefined)
    return this.service.list({ actorId: req.user.id, resourceType: q.resourceType, resourceId: q.resourceId, eventType: q.eventType, eventTypePrefixes: prefixes, since: q.since, page: Number(q.page) || 1, size: Number(q.size) || 20 })
  }
}
