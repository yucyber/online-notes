import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { SemanticController } from './semantic.controller'
import { SemanticService } from './semantic.service'
import { EmbeddingService } from './embedding.service'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { TagsModule } from '../tags/tags.module'
import { AiModule } from '../ai/ai.module'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
    TagsModule,
    forwardRef(() => AiModule)
  ],
  controllers: [SemanticController],
  providers: [SemanticService, EmbeddingService],
  exports: [SemanticService, EmbeddingService],
})
export class SemanticModule { }
