import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Throttle } from '@nestjs/throttler'
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator'
import type { Request, Response } from 'express'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { AssistantMessagesService } from './assistant-messages.service'
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
    return this.generation.cancel(requestId, this.userId(req) || '')
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
    return this.conversations.rename(this.userId(req) || '', id, String(title || ''))
  }

  @Post('conversations/:id/archive')
  async archive(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.conversations.setStatus(this.userId(req) || '', id, 'archived')
  }

  @Post('conversations/:id/unarchive')
  async unarchive(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.conversations.setStatus(this.userId(req) || '', id, 'active')
  }

  @Post('conversations/:id/delete')
  async deleteConversation(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req) || ''
    // 软删除前取消该会话正在运行的生成，避免删除后生成继续写消息。
    await this.generation.cancelByConversation(userId, id)
    return this.conversations.setStatus(userId, id, 'deleted')
  }

  private userId(req?: AuthenticatedRequest): string | undefined {
    const user = req?.user
    return user?.id || user?._id || user?.userId
  }
}
