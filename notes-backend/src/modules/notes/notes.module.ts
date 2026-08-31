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
import { NoteChunk, NoteChunkSchema } from './schemas/note-chunk.schema';
import { NoteChunkerService } from './note-chunker.service';
import { NoteChunkIndexService } from './note-chunk-index.service';
import { NoteVectorBackfillRunner } from './note-vector-backfill.runner';
import { Note, NoteSchema } from './schemas/note.schema';
import { CategoriesModule } from '../categories/categories.module';
import { TagsModule } from '../tags/tags.module';
import { SemanticModule } from '../semantic/semantic.module';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { Mindmap, MindmapSchema } from '../mindmaps/schemas/mindmap.schema';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { NoteDerivedQueueService } from './note-derived-queue.service';
import { NoteDerivedWorker } from './note-derived.worker';
import { NOTE_DERIVED_QUEUE } from './note-derived-job.types';

export const NOTE_DERIVED_QUEUE_CONNECTION = Symbol('NOTE_DERIVED_QUEUE_CONNECTION')

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: Mindmap.name, schema: MindmapSchema },
      { name: NoteChunk.name, schema: NoteChunkSchema },
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
  providers: [
    NotesService, NoteAccessService, NoteCounterService, NoteCacheService, NoteRecommendationService,
    NoteDerivedService, NoteVectorSourceService, NoteChunkerService, NoteChunkIndexService, NoteVectorBackfillRunner,
    {
      provide: NOTE_DERIVED_QUEUE_CONNECTION,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => redis.duplicate({ maxRetriesPerRequest: null }),
    },
    {
      provide: NOTE_DERIVED_QUEUE,
      inject: [NOTE_DERIVED_QUEUE_CONNECTION],
      useFactory: (connection: Redis) => new Queue(NOTE_DERIVED_QUEUE, { connection }),
    },
    {
      provide: NoteDerivedQueueService,
      inject: [NOTE_DERIVED_QUEUE, NOTE_DERIVED_QUEUE_CONNECTION, REDIS_CLIENT, ConfigService],
      useFactory: (queue: Queue, connection: Redis, redis: Redis, config: ConfigService) => new NoteDerivedQueueService(
        queue,
        Math.max(0, Number(config.get('NOTE_DERIVED_QUIET_MS') || 10_000)),
        redis,
        connection,
      ),
    },
    NoteDerivedWorker,
  ],
  exports: [NotesService, NoteAccessService, NoteCounterService, NoteCacheService, NoteVectorBackfillRunner, NOTE_DERIVED_QUEUE],
})
export class NotesModule { }
