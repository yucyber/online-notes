import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiController } from './ai.controller';
import { AiGatewayClient } from './ai-gateway.client';
import { AiRunService } from './ai-run.service';
import { AiService } from './ai.service';
import { AiRun, AiRunSchema } from './schemas/ai-run.schema';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { AiProviderCapacityService } from './ai-provider-capacity.service';
import { SemanticModule } from '../semantic/semantic.module';
import { QueryPlannerService } from './rag/query-planner.service';
import { RagRetrievalService } from './rag/rag-retrieval.service';
import { RagAnswerService } from './rag/rag-answer.service';
import { RagStreamService } from './rag/rag-stream.service';

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([{ name: AiRun.name, schema: AiRunSchema }]),
        forwardRef(() => KnowledgeBasesModule),
        forwardRef(() => SemanticModule),
    ],
    controllers: [AiController],
    providers: [AiGatewayClient, AiService, AiRunService, AiProviderCapacityService, QueryPlannerService, RagRetrievalService, RagAnswerService, RagStreamService],
    exports: [AiService, AiRunService, AiProviderCapacityService, RagStreamService],
})
export class AiModule { }
