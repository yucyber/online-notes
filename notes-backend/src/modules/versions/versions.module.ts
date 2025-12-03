import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { VersionsController } from './versions.controller'
import { VersionsService } from './versions.service'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { NoteVersion, NoteVersionSchema } from './schemas/note-version.schema'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: NoteVersion.name, schema: NoteVersionSchema },
    ]),
    AuditModule,
  ],
  controllers: [VersionsController],
  providers: [VersionsService],
})
export class VersionsModule {}
