import { Module } from '@nestjs/common'
import { NotesModule } from '../notes/notes.module'
import { QueueMonitorService } from './queue-monitor.service'

@Module({
  imports: [NotesModule],
  providers: [QueueMonitorService],
})
export class QueueMonitorModule {}
