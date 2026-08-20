import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuditService } from './audit.service'
import { AuditController } from './audit.controller'
import { AuditEntry, AuditEntrySchema } from './schemas/audit-entry.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'

@Module({
  imports: [MongooseModule.forFeature([{ name: AuditEntry.name, schema: AuditEntrySchema }, { name: Note.name, schema: NoteSchema }])],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
