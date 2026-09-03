import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Category, CategorySchema } from '../categories/schemas/category.schema'
import { KnowledgeBase, KnowledgeBaseSchema } from '../knowledge-bases/schemas/knowledge-base.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { NoteChunk, NoteChunkSchema } from '../notes/schemas/note-chunk.schema'
import { NotesModule } from '../notes/notes.module'
import { Tag, TagSchema } from '../tags/schemas/tag.schema'
import { OrganizerController } from './organizer.controller'
import { OrganizerProposalService } from './organizer-proposal.service'
import { OrganizerPlanningService } from './organizer-planning.service'
import { OrganizerProposal, OrganizerProposalSchema } from './schemas/organizer-proposal.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrganizerProposal.name, schema: OrganizerProposalSchema },
      { name: Note.name, schema: NoteSchema },
      { name: NoteChunk.name, schema: NoteChunkSchema },
      { name: Tag.name, schema: TagSchema },
      { name: Category.name, schema: CategorySchema },
      { name: KnowledgeBase.name, schema: KnowledgeBaseSchema },
    ]),
    NotesModule,
  ],
  controllers: [OrganizerController],
  providers: [OrganizerProposalService, OrganizerPlanningService],
  exports: [OrganizerProposalService, OrganizerPlanningService],
})
export class OrganizerModule {}
