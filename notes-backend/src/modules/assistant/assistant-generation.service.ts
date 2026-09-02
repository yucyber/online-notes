import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AiService } from '../ai/ai.service'
import { RagStreamService } from '../ai/rag/rag-stream.service'
import { AssistantStreamEvent } from './assistant-stream-format'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantMessagesService } from './assistant-messages.service'

const NOTE_INTENT = /(我的笔记|笔记里|之前|当时|踩坑|查找|找到|搜索|哪篇|比较|区别|差异|冲突|矛盾|知识库)/i

@Injectable()
export class AssistantGenerationService {
  private readonly logger = new Logger(AssistantGenerationService.name)
  private readonly emitters = new Map<string, EventEmitter>()
  private readonly running = new Set<string>()
  private readonly cancelKeys = new Set<string>()
  // requestId -> 生成停止时 resolve 的 promise：cancel 等待它，保证返回时 cancelled 已落库并广播。
  private readonly stops = new Map<string, Promise<void>>()
  // requestId -> 生成循环真正在跑：与 running（start 占位）分离，重放时据此区分"进程内活跃生成"与"重启残留/半途崩溃"。
  private readonly activeGenerations = new Set<string>()

  constructor(
    private readonly conversations: AssistantConversationsService,
    private readonly messages: AssistantMessagesService,
    private readonly ragStream: RagStreamService,
    private readonly aiService: AiService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  isRunning(requestId: string): boolean { return this.running.has(requestId) }

  // SSE 控制器用：保持响应打开直到生成到达终态（complete/cancelled/failed），再 res.end()。
  // 生成已结束时返回立即 resolve 的 promise（stops 已被 finish 删除）；运行中返回 stop promise，finish 时 resolve。
  waitForTerminal(requestId: string): Promise<void> {
    const stop = this.stops.get(requestId)
    return stop || Promise.resolve()
  }

  async start(input: { userId: string; conversationId?: string; requestId: string; question: string; knowledgeBaseId?: string; forceRoute?: 'pet' | 'rag' }, emit: (event: AssistantStreamEvent) => void): Promise<void> {
    const { userId, requestId } = input
    if (this.running.has(requestId)) { this.attach(requestId, emit); return }

    // 同步段先占位运行态并注册停止处理器：cancel 在 start 首个 await 前调用也能等到生成停止。
    this.running.add(requestId)
    let resolveStop!: () => void
    const stop = new Promise<void>((resolve) => { resolveStop = resolve })
    this.stops.set(requestId, stop)
    const emitter = new EventEmitter()
    this.emitters.set(requestId, emitter)
    emitter.on('event', (event: AssistantStreamEvent) => { try { emit(event) } catch { /* 订阅者已断开 */ } })
    const finish = () => {
      this.running.delete(requestId)
      this.emitters.delete(requestId)
      this.stops.delete(requestId)
      resolveStop()
    }
    try {
      // 幂等：同一 (userId, requestId) 已有消息时不重复生成，直接补发终态。
      const existing = await this.messages.getByRequestId(userId, requestId)
      if (existing) {
        emit({ event: 'started', data: { conversationId: String(existing.conversationId), userMessageId: existing.retryOfMessageId || '', assistantMessageId: existing.id, requestId } })
        // 正常重放：assistant 消息已是终态（complete/failed/cancelled）→ 补发 complete。
        if (existing.role === 'assistant' && (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled')) {
          emit({ event: 'complete', data: { messageId: existing.id, route: existing.route, citations: existing.citations, warnings: existing.warnings } })
        } else if (this.activeGenerations.has(requestId)) {
          // 进程内生成仍在跑（同实例重连）：订阅现有 emitter 续收事件。
          this.attach(requestId, emit)
        } else {
          // stale：服务重启后残留非终态 assistant 消息，或崩溃窗口只剩 user 提问（appendUser 与 createPlaceholder 之间）——
          // 生成已不可能到达终态，落库 failed（保留已流内容）并补发 error，避免 DB 消息永久 streaming 且客户端断流。
          if (existing.role === 'assistant') {
            await this.messages.markFailed(userId, existing.id, existing.content || '回答生成中断')
          }
          emit({ event: 'error', data: { code: 'GENERATION_INTERRUPTED', message: '回答生成中断，请重试。', retryable: true } })
        }
        finish()
        return
      }

      const route: 'pet' | 'rag' = input.forceRoute === 'pet' || input.forceRoute === 'rag'
        ? input.forceRoute
        : (input.forceRoute === 'rag' || NOTE_INTENT.test(input.question) ? 'rag' : 'pet')
      // 尊重前端指定的会话：带 userId 归属校验；id 失效（已删除/无权限）时回退到最新 active 会话，避免新消息落入不存在会话。
      const conversation = input.conversationId
        ? (await this.conversations.get(userId, input.conversationId)) ?? (await this.conversations.ensure(userId, input.knowledgeBaseId ? { knowledgeBaseId: input.knowledgeBaseId } : undefined))
        : await this.conversations.ensure(userId, input.knowledgeBaseId ? { knowledgeBaseId: input.knowledgeBaseId } : undefined)
      const userMessage = await this.messages.appendUser(userId, conversation.id, route, input.question, requestId)
      const assistantMessage = await this.messages.createPlaceholder(userId, conversation.id, route, requestId)
      await this.conversations.touch(userId, conversation.id, { lastMessageAt: new Date(), messageCount: userMessage.seq + 1, knowledgeBaseId: input.knowledgeBaseId ?? null })
      emitter.emit('event', { event: 'started', data: { conversationId: conversation.id, userMessageId: userMessage.messageId, assistantMessageId: assistantMessage.messageId, requestId } })

      // 后台继续生成：HTTP 断开不中止，订阅者通过 attach 重连。
      // finally 后的 catch 兜底：catch 块内落库（flush/markCancelled/markFailed）失败时避免 unhandledRejection 崩溃进程。
      void this.runGeneration({ ...input, conversationId: conversation.id, assistantMessageId: assistantMessage.messageId, route }, emitter).finally(() => finish())
        .catch((e) => this.logger.error('assistant generation cleanup failed', e))
    } catch (error) {
      // 前置步骤失败时释放占位，避免 requestId 永久停留在运行态。
      finish()
      throw error
    }
  }

  attach(requestId: string, emit: (event: AssistantStreamEvent) => void): void {
    const emitter = this.emitters.get(requestId)
    if (emitter) emitter.on('event', (event: AssistantStreamEvent) => { try { emit(event) } catch { /* ignore */ } })
  }

  async cancel(requestId: string, userId: string): Promise<{ cancelled: boolean; reason?: 'not_found' | 'not_running' }> {
    // 授权校验：仅请求归属者可取消——(userId, requestId) 查无此消息（他人请求或不存在）则静默返回，
    // 不写取消标记、不广播、不等待（getByRequestId 本身按 userId 约束）。
    const owned = await this.messages.getByRequestId(userId, requestId)
    if (!owned) return { cancelled: false, reason: 'not_found' }
    // 未运行/已结束的请求不写取消标记：cancelKeys 只在 runGeneration 的 finally 清理，避免无界增长。
    if (!this.running.has(requestId)) return { cancelled: false, reason: 'not_running' }
    // 单实例内存取消标记为当前实现；跨实例取消通过 Redis 发布订阅增强（后续阶段）。
    this.cancelKeys.add(requestId)
    const emitter = this.emitters.get(requestId)
    if (emitter) emitter.emit('event', { event: 'error', data: { code: 'CANCELLED', message: '已停止生成', retryable: false } })
    // 等待生成循环真正停止：cancel 返回时 cancelled 已落库并广播。
    const stop = this.stops.get(requestId)
    if (stop) await stop
    return { cancelled: true }
  }

  private async runGeneration(input: { userId: string; conversationId: string; assistantMessageId: string; requestId: string; question: string; knowledgeBaseId?: string; route: 'pet' | 'rag' }, emitter: EventEmitter): Promise<void> {
    const { userId, assistantMessageId, requestId, route } = input
    // 生成循环真正开始：重放路径据此识别"进程内活跃生成"（可重连），与 start 的 running 占位区分。
    this.activeGenerations.add(requestId)
    let content = ''
    let flushedAt = 0
    let flushedChars = 0
    const flush = async (force: boolean) => {
      // 批量落库：每 500ms 或新增 200 字符写一次。
      const now = Date.now()
      if (!force && now - flushedAt < 500 && content.length - flushedChars < 200) return
      await this.messages.appendDelta(userId, assistantMessageId, content)
      flushedAt = now
      flushedChars = content.length
    }
    const cancelled = () => this.cancelKeys.has(requestId)
    const emitDelta = async (text: string) => {
      content += text
      await flush(false)
      emitter.emit('event', { event: 'delta', data: { text } })
    }
    try {
      if (route === 'rag') {
        emitter.emit('event', { event: 'status', data: { stage: 'routing', message: '正在检索你的笔记' } })
        const result = await this.ragStream.streamRagAnswer(
          { question: input.question, knowledgeBaseId: input.knowledgeBaseId, userId },
          {
            onStatus: async (stage, message) => { if (cancelled()) throw new Error('CANCELLED'); emitter.emit('event', { event: 'status', data: { stage, message } }) },
            onDelta: async (text) => { if (cancelled()) throw new Error('CANCELLED'); await emitDelta(text) },
          },
        )
        if (cancelled()) throw new Error('CANCELLED')
        await flush(true)
        await this.messages.finalize(userId, assistantMessageId, { content, citations: result.citations, warnings: result.warnings })
        emitter.emit('event', { event: 'complete', data: { messageId: assistantMessageId, route: 'rag', citations: result.citations, warnings: result.warnings, planSummary: result.planSummary, runId: result.runId } })
      } else {
        emitter.emit('event', { event: 'status', data: { stage: 'routing', message: '小助手正在回复' } })
        const stream = await this.aiService.chatPet({ message: input.question }, { userId })
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              if (cancelled()) throw new Error('CANCELLED')
              await emitDelta(decoder.decode(value, { stream: true }))
            }
          }
        } finally { decoder.decode() }
        await flush(true)
        await this.messages.finalize(userId, assistantMessageId, { content, citations: [], warnings: [] })
        emitter.emit('event', { event: 'complete', data: { messageId: assistantMessageId, route: 'pet', citations: [], warnings: [] } })
      }
    } catch (error: any) {
      if (cancelled() || String(error?.message) === 'CANCELLED') {
        await flush(true)
        await this.messages.markCancelled(userId, assistantMessageId, content)
        emitter.emit('event', { event: 'cancelled', data: { messageId: assistantMessageId, text: content, reason: 'user_stopped' } })
      } else {
        await this.messages.markFailed(userId, assistantMessageId, content || '回答生成中断')
        emitter.emit('event', { event: 'error', data: { code: 'PROVIDER_UNAVAILABLE', message: '回答生成中断，请稍后重试。', retryable: true } })
        this.logger.warn(`assistant generation failed: ${error?.message}`)
      }
    } finally {
      this.cancelKeys.delete(requestId)
      this.activeGenerations.delete(requestId)
    }
  }
}
