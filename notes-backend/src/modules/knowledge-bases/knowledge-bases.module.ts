import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { NotesModule } from '../notes/notes.module'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { KnowledgeBasesController } from './knowledge-bases.controller'
import { KnowledgeBasesService } from './knowledge-bases.service'
import { KnowledgeBase, KnowledgeBaseSchema } from './schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteSchema } from './schemas/knowledge-base-note.schema'

@Module({
  imports: [
    forwardRef(() => NotesModule),
    MongooseModule.forFeature([
      { name: KnowledgeBase.name, schema: KnowledgeBaseSchema },
      { name: KnowledgeBaseNote.name, schema: KnowledgeBaseNoteSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
  ],
  controllers: [KnowledgeBasesController],
  providers: [KnowledgeBasesService],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
