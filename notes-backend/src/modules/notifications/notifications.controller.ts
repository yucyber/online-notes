import { Controller, Get, Patch, Param, Query, UseGuards, Request } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { NotificationsService } from './notifications.service'

@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(@Query() q: any, @Request() req) {
    return this.service.list(req.user.id, Number(q.page) || 1, Number(q.size) || 20, q.type, q.status)
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @Request() req) {
    return this.service.markRead(id, req.user.id)
  }
}
