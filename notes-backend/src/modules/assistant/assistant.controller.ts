import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Throttle } from '@nestjs/throttler'
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator'
import type { Request, Response } from 'express'
import { MemoryKind, MemoryScope } from './assistant.constants'
import { MemoryConfirmEdits, MemoryCandidatesService } from './assistant-memory-candidates.service'
import { AssistantCheckpointService } from './assistant-checkpoint.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { buildExportLines } from './assistant-export'
import { formatSseEvent } from './assistant-stream-format'

class AssistantChatDto {
  @IsString() @MaxLength(128)
  requestId: string
  @IsString() @MaxLength(2000)
  question: string
  @IsOptional() @IsMongoId()
  conversationId?: string
  @IsOptional() @IsMongoId()
  knowledgeBaseId?: string
  @IsOptional() @IsEnum(['pet', 'rag'])
  forceRoute?: 'pet' | 'rag'
  @IsOptional() @IsMongoId()
  retryOfMessageId?: string
}

type AuthenticatedRequest = Request & { user?: { id?: string; _id?: string; userId?: string } }

// chat 与 cancel 不依赖全局 IdempotencyInterceptor 的响应级幂等（前端不得给这两个端点带 Idempotency-Key 头）：
// 生成服务已原生实现 (userId, requestId) 幂等（start 重放/attach），且 SSE 响应无法被响应级缓存有意义地复用——
// 重试命中缓存会返回损坏的 JSON 信封，重连命中 in-flight 锁会误报 CONFLICT。
@Throttle({ short: { ttl: 60_000, limit: 40 } })
@UseGuards(AuthGuard('jwt'))
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly generation: AssistantGenerationService,
    private readonly messages: AssistantMessagesService,
    private readonly conversations: AssistantConversationsService,
    private readonly checkpoints: AssistantCheckpointService,
    // 记忆候选服务依赖的 schema 与 provider 已在 assistant.module.ts 注册；
    // 参数保持可选语法仅为兼容既有 4 参直接构造的 controller 测试（DI 正常注入）。
    private readonly memoryCandidates?: MemoryCandidatesService,
  ) {}

  @Post('chat')
  async chat(@Body() body: AssistantChatDto, @Res() res: Response, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    const emit = (event: any) => { if (!res.writableEnded) res.write(formatSseEvent(event)) }
    // start 后台续跑、返回早；waitForTerminal 保持响应打开直到终态事件（complete/cancelled/failed）落定后 res.end()，
    // 客户端才能收全 started/status/delta/complete 流（与 ai.controller 流式端点等流读完再 end 的模式一致）。
    await this.generation.start(
      { userId, conversationId: body.conversationId, requestId: body.requestId, question: body.question, knowledgeBaseId: body.knowledgeBaseId, forceRoute: body.forceRoute, retryOfMessageId: body.retryOfMessageId },
      emit,
    )
    await this.generation.waitForTerminal(body.requestId)
    res.end()
  }

  @Post('generations/:requestId/cancel')
  async cancel(@Param('requestId') requestId: string, @Req() req?: AuthenticatedRequest) {
    // 返回实际取消结果（not_found/not_running 如实上报，不再静默回 cancelled:true）
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.generation.cancel(requestId, userId)
  }

  @Get('conversations')
  async listConversations(@Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return { items: await this.conversations.list(userId) }
  }

  @Get('conversations/:id/messages')
  async listMessages(@Param('id') id: string, @Query('afterSeq') afterSeq?: string, @Query('limit') limit?: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    const items = await this.messages.list(userId, id, {
      ...(afterSeq !== undefined ? { afterSeq: Number(afterSeq) || 0 } : {}),
      ...(limit !== undefined ? { limit: Math.min(200, Number(limit) || 200) } : {}),
    })
    return { items }
  }

  // 导出会话为 JSONL 附件：conversation 行的 createdAt 取会话 updatedAt（阶段一 get 只返回 id/title/status，本端点按会话更新时间标记导出时点）。
  // 走 @Res 直接写流（与 chat SSE 一致，绕过 ApiEnvelopeInterceptor 的 JSON 信封）；归属校验在 conversations.get 内完成（带 userId 过滤）。
  @Get('conversations/:id/export')
  async exportConversation(@Param('id') id: string, @Res() res: Response, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    const conversation = await this.conversations.get(userId, id)
    if (!conversation) throw new NotFoundException('会话不存在')
    const messages = await this.messages.listAll(userId, id)
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="assistant-${id}.jsonl"`)
    res.write(buildExportLines({ id, title: conversation.title, createdAt: conversation.updatedAt }, messages).join('\n'))
    res.end()
  }

  @Get('search')
  async search(@Query('q') q: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return {
      conversations: await this.conversations.searchByTitle(userId, String(q || '')),
      messages: await this.messages.searchMessages(userId, String(q || '')),
    }
  }

  @Patch('conversations/:id')
  async renameConversation(@Param('id') id: string, @Body('title') title: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.conversations.rename(userId, id, String(title || ''))
  }

  // 会话记忆设置（阶段四）：只更新显式传入的开关，未传字段保持原值；会话不存在/无权时由 service 抛 NotFound。
  @Patch('conversations/:id/settings')
  async updateConversationSettings(@Param('id') id: string, @Body('settings') settings: { memoryEnabled?: boolean; temporary?: boolean }, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.conversations.updateSettings(userId, id, settings || {})
  }

  @Post('conversations/:id/archive')
  async archive(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.conversations.setStatus(userId, id, 'archived')
  }

  @Post('conversations/:id/unarchive')
  async unarchive(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.conversations.setStatus(userId, id, 'active')
  }

  @Post('conversations/:id/delete')
  async deleteConversation(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    // 软删除前取消该会话正在运行的生成，避免删除后生成继续写消息。
    await this.generation.cancelByConversation(userId, id)
    return this.conversations.setStatus(userId, id, 'deleted')
  }

  @Post('conversations/:id/branch')
  async branch(@Param('id') id: string, @Body('fromSeq') fromSeq: number, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    const seq = Math.max(1, Number(fromSeq) || 0)
    return this.conversations.branch(userId, id, seq, this.messages)
  }

  // 手动整理：立即压缩该会话（不等待 schedule 阈值），返回最新 checkpoint 视图。
  @Post('conversations/:id/checkpoint')
  async checkpoint(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.checkpoints.build(userId, id)
  }

  // 认知记忆候选（阶段四 Task 3）：pending 列表与确认/拒绝/批量确认。
  // 候选确认遇同 scope 主题重叠时由 service 返回 { memoryId: '', conflict }，由前端引导冲突解决。
  @Get('memories/candidates')
  async listMemoryCandidates(@Query('status') status?: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    if (status !== undefined && status !== 'pending') throw new BadRequestException('仅支持 status=pending')
    return { items: await this.memoryCandidates.listPending(userId) }
  }

  @Post('memories/candidates/:id/confirm')
  async confirmMemoryCandidate(@Param('id') id: string, @Body('edits') edits?: MemoryConfirmEdits, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.memoryCandidates.confirm(userId, id, edits)
  }

  @Post('memories/candidates/:id/reject')
  async rejectMemoryCandidate(@Param('id') id: string, @Body('reason') reason?: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    await this.memoryCandidates.reject(userId, id, String(reason || ''))
    return { ok: true }
  }

  @Post('memories/candidates/batch-confirm')
  async batchConfirmMemoryCandidates(@Body() body: { ids?: string[]; kind?: MemoryKind; scope?: MemoryScope }, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    return this.memoryCandidates.batchConfirm(userId, Array.isArray(body?.ids) ? body.ids.map(String) : [], { kind: body?.kind, scope: body?.scope })
  }

  private userId(req?: AuthenticatedRequest): string | undefined {
    const user = req?.user
    return user?.id || user?._id || user?.userId
  }
}
