import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { SemanticController } from './semantic.controller'
import { SemanticService } from './semantic.service'
import { EmbeddingService } from './embedding.service'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { TagsModule } from '../tags/tags.module'
import { AiModule } from '../ai/ai.module'
import { NotesModule } from '../notes/notes.module'
import { NoteChunk, NoteChunkSchema } from '../notes/schemas/note-chunk.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteSchema } from '../knowledge-bases/schemas/knowledge-base-note.schema'
import { ChunkRetrievalService } from './chunk-retrieval.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: NoteChunk.name, schema: NoteChunkSchema },
      { name: KnowledgeBaseNote.name, schema: KnowledgeBaseNoteSchema },
    ]),
    TagsModule,
    forwardRef(() => AiModule),
    forwardRef(() => NotesModule),
  ],
  controllers: [SemanticController],
  providers: [SemanticService, EmbeddingService, ChunkRetrievalService],
  exports: [SemanticService, EmbeddingService, ChunkRetrievalService],
})
export class SemanticModule { }
