import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Category, CategorySchema } from '../categories/schemas/category.schema'
import { KnowledgeBase, KnowledgeBaseSchema } from '../knowledge-bases/schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteSchema } from '../knowledge-bases/schemas/knowledge-base-note.schema'
import { NoteVersion, NoteVersionSchema } from '../versions/schemas/note-version.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { NoteChunk, NoteChunkSchema } from '../notes/schemas/note-chunk.schema'
import { NotesModule } from '../notes/notes.module'
import { AuditModule } from '../audit/audit.module'
import { Tag, TagSchema } from '../tags/schemas/tag.schema'
import { OrganizerController } from './organizer.controller'
import { OrganizerProposalService } from './organizer-proposal.service'
import { OrganizerPlanningService } from './organizer-planning.service'
import { OrganizerExecutionService } from './organizer-execution.service'
import { OrganizerAgentService } from './organizer-agent.service'
import { OrganizerProposal, OrganizerProposalSchema } from './schemas/organizer-proposal.schema'
import { OrganizerExecution, OrganizerExecutionSchema } from './schemas/organizer-execution.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrganizerProposal.name, schema: OrganizerProposalSchema },
      { name: OrganizerExecution.name, schema: OrganizerExecutionSchema },
      { name: Note.name, schema: NoteSchema },
      { name: NoteChunk.name, schema: NoteChunkSchema },
      { name: Tag.name, schema: TagSchema },
      { name: Category.name, schema: CategorySchema },
      { name: KnowledgeBase.name, schema: KnowledgeBaseSchema },
      { name: KnowledgeBaseNote.name, schema: KnowledgeBaseNoteSchema },
      { name: NoteVersion.name, schema: NoteVersionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotesModule,
    AuditModule,
  ],
  controllers: [OrganizerController],
  providers: [OrganizerProposalService, OrganizerPlanningService, OrganizerExecutionService, OrganizerAgentService],
  exports: [OrganizerProposalService, OrganizerPlanningService, OrganizerExecutionService, OrganizerAgentService],
})
export class OrganizerModule {}
