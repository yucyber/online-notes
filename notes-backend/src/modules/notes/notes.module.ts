import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { NoteAccessService } from './note-access.service';
import { NoteCounterService } from './note-counter.service';
import { NoteCacheService } from './note-cache.service';
import { NoteRecommendationService } from './note-recommendation.service';
import { NoteDerivedService } from './note-derived.service';
import { NoteVectorSourceService } from './note-vector-source.service';
import { Note, NoteSchema } from './schemas/note.schema';
import { CategoriesModule } from '../categories/categories.module';
import { TagsModule } from '../tags/tags.module';
import { SemanticModule } from '../semantic/semantic.module';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { Mindmap, MindmapSchema } from '../mindmaps/schemas/mindmap.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: Mindmap.name, schema: MindmapSchema },
    ]),
    CategoriesModule,
    forwardRef(() => TagsModule),
    forwardRef(() => SemanticModule),
    forwardRef(() => AiModule),
    AuditModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotesController],
  providers: [NotesService, NoteAccessService, NoteCounterService, NoteCacheService, NoteRecommendationService, NoteDerivedService, NoteVectorSourceService],
  exports: [NotesService, NoteAccessService, NoteCounterService, NoteCacheService],
})
export class NotesModule { }
