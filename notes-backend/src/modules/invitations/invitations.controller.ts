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
    const { role, inviteeEmail, ttlHours } = body
    return this.service.create(id, req.user.id, role, inviteeEmail, ttlHours)
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

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async preview(@Param('id') id: string, @Request() req) {
    return this.service.preview(id)
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/accept')
  async accept(@Param('id') id: string, @Request() req) {
    return this.service.accept(id, req.user.id)
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async revoke(@Param('id') id: string, @Request() req) {
    return this.service.revoke(id, req.user.id)
  }
}
