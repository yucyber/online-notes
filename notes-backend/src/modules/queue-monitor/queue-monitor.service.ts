import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpAdapterHost } from '@nestjs/core'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { Queue } from 'bullmq'
import { NOTE_DERIVED_QUEUE } from '../notes/note-derived-job.types'
import { NoteDerivedJobData } from '../notes/note-derived-job.types'
import { createQueueMonitorAuth } from './queue-monitor-auth'

@Injectable()
export class QueueMonitorService implements OnModuleInit {
  private readonly logger = new Logger(QueueMonitorService.name)

  constructor(
    private readonly config: ConfigService,
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(NOTE_DERIVED_QUEUE) private readonly queue: Queue<NoteDerivedJobData>,
  ) {}

  onModuleInit() {
    const username = this.config.get<string>('BULL_BOARD_USERNAME')
    const password = this.config.get<string>('BULL_BOARD_PASSWORD')
    if (!username || !password) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error('Bull Board credentials are required in production')
      }
      this.logger.warn('Bull Board is disabled because credentials are not configured')
      return
    }
    // CLI 使用 standalone application context，没有 HTTP server 可供 Bull Board 挂载。
    if (!this.httpAdapterHost.httpAdapter) {
      this.logger.warn('Bull Board is disabled because no HTTP adapter is available')
      return
    }

    const basePath = '/admin/queues'
    const serverAdapter = new ExpressAdapter()
    serverAdapter.setBasePath(basePath)
    createBullBoard({ queues: [new BullMQAdapter(this.queue)], serverAdapter })
    this.httpAdapterHost.httpAdapter.getInstance().use(
      basePath,
      createQueueMonitorAuth(username, password),
      serverAdapter.getRouter(),
    )
  }
}
