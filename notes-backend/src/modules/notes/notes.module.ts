import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { NoteAccessService } from './note-access.service';
import { NoteCounterService } from './note-counter.service';
import { NoteCacheService } from './note-cache.service';
import { Note, NoteSchema } from './schemas/note.schema';
import { CategoriesModule } from '../categories/categories.module';
import { TagsModule } from '../tags/tags.module';
import { SemanticModule } from '../semantic/semantic.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
    CategoriesModule,
    TagsModule,
    forwardRef(() => SemanticModule),
    forwardRef(() => AiModule),
  ],
  controllers: [NotesController],
  providers: [NotesService, NoteAccessService, NoteCounterService, NoteCacheService],
  exports: [NotesService, NoteAccessService, NoteCounterService],
})
export class NotesModule { }
