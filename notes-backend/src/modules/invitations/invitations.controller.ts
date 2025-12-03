import { Controller, UseGuards, Post, Get, Delete, Param, Body, Request, Query } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { InvitationsService } from './invitations.service'
import { UsersService } from '../users/users.service'

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly service: InvitationsService, private readonly users: UsersService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('notes/:id')
  async create(@Param('id') id: string, @Body() body: any, @Request() req) {
    const { role, inviteeEmail, ttlHours, requestId } = body
    return this.service.create(id, req.user.id, role, inviteeEmail, ttlHours, requestId)
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('notes/:id')
  async list(@Param('id') id: string, @Request() req) {
    return this.service.listForNote(id, req.user.id)
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('mine')
  async mine(@Query() q: any, @Request() req) {
    const email = req.user?.email
    const status = q.status || 'pending'
    return this.service.listMine(email, status)
  }

  @Get(':token')
  async preview(@Param('token') token: string) {
    return this.service.preview(token)
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':token/accept')
  async accept(@Param('token') token: string, @Body() body: any, @Request() req) {
    const { requestId } = body
    return this.service.accept(token, req.user.id, requestId)
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':token')
  async revoke(@Param('token') token: string, @Request() req) {
    return this.service.revoke(token, req.user.id)
  }
}
