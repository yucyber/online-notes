import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { Note, NoteSchema } from './schemas/note.schema';
import { CategoriesModule } from '../categories/categories.module';
import { TagsModule } from '../tags/tags.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
    CategoriesModule,
    TagsModule,
  ],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}