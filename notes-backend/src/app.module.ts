import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from './common/redis/redis.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { NotesModule } from './modules/notes/notes.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { TagsModule } from './modules/tags/tags.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SavedFiltersModule } from './modules/saved-filters/saved-filters.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AuditModule } from './modules/audit/audit.module';
import { VersionsModule } from './modules/versions/versions.module';
import { CommentsModule } from './modules/comments/comments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SemanticModule } from './modules/semantic/semantic.module';
import { RumModule } from './modules/rum/rum.module';
import { BoardsModule } from './modules/boards/boards.module';
import { MindmapsModule } from './modules/mindmaps/mindmaps.module';
import { AiModule } from './modules/ai/ai.module';
import { KnowledgeBasesModule } from './modules/knowledge-bases/knowledge-bases.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    RedisModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI') || 'mongodb://localhost:27017/notes',
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    NotesModule,
    CategoriesModule,
    TagsModule,
    DashboardModule,
    SavedFiltersModule,
    HealthModule,
    InvitationsModule,
    AuditModule,
    VersionsModule,
    CommentsModule,
    NotificationsModule,
    SemanticModule,
    RumModule,
    BoardsModule,
    MindmapsModule,
    AiModule,
    KnowledgeBasesModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
  ],
})
export class AppModule { }
