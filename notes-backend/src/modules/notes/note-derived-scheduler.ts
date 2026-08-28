import { Injectable } from '@nestjs/common'
import { NoteDerivedJobData } from './note-derived-job.types'
import { NoteDerivedQueueService } from './note-derived-queue.service'

@Injectable()
export class NoteDerivedScheduler {
  constructor(private readonly queue: NoteDerivedQueueService) {}

  schedule(data: NoteDerivedJobData): Promise<unknown> {
    return this.queue.schedule(data)
  }
}
