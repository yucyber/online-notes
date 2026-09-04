import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { OrganizerPlanningService } from './organizer-planning.service'
import { OrganizerProposalService } from './organizer-proposal.service'
import { OrganizerExecutionService } from './organizer-execution.service'
import { OrganizerAgentService } from './organizer-agent.service'

@UseGuards(AuthGuard('jwt'))
@Controller('organizer')
export class OrganizerController {
  constructor(
    private readonly proposals: OrganizerProposalService,
    private readonly planning: OrganizerPlanningService,
    private readonly execution: OrganizerExecutionService,
    private readonly agent: OrganizerAgentService,
  ) {}

  @Get('proposals')
  listProposals(@Request() req) {
    return this.proposals.findAll(req.user.id)
  }

  @Get('proposals/:id')
  getProposal(@Param('id') id: string, @Request() req) {
    return this.proposals.findOne(id, req.user.id)
  }

  @Delete('proposals/:id')
  deleteProposal(@Param('id') id: string, @Request() req) {
    return this.proposals.remove(id, req.user.id)
  }


  @Post('proposals/:id/execute')
  executeProposal(@Param('id') id: string, @Body() body: { actionIds?: string[]; requestId?: string }, @Request() req) {
    return this.execution.execute(req.user.id, id, body?.actionIds || [], body?.requestId)
  }

  @Get('executions')
  listExecutions(@Request() req) {
    return this.execution.list(req.user.id)
  }

  @Post('executions/:id/undo')
  undoExecution(@Param('id') id: string, @Body() body: { requestId?: string }, @Request() req) {
    return this.execution.undo(req.user.id, id, body?.requestId)
  }

  @Post('proposals/:id/refresh-stale')
  refreshStale(@Param('id') id: string, @Request() req) {
    return this.proposals.refreshStale(id, req.user.id)
  }

  // 小助手手动触发：为当前用户生成全局提案（已有 pending 提案则直接返回）。
  @Post('agent/run')
  runAgent(@Request() req) {
    return this.agent.runForUser(req.user.id)
  }

  @Post('planning/global')
  createGlobal(@Request() req) {
    return this.planning.createGlobalProposal(req.user.id)
  }

  @Post('planning/incremental/:noteId')
  createIncremental(@Param('noteId') noteId: string, @Request() req) {
    return this.planning.createIncrementalProposal(req.user.id, noteId)
  }
}
