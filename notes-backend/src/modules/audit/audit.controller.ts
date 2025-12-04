import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { AuditService } from './audit.service'

@UseGuards(AuthGuard('jwt'))
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}
  @Get('logs')
  async list(@Query() q: any) {
    const data = await this.service.list({ resourceType: q.resourceType, resourceId: q.resourceId, eventType: q.eventType, page: Number(q.page) || 1, size: Number(q.size) || 20 })
    return { code: 0, message: 'OK', data, timestamp: Date.now() }
  }
}
