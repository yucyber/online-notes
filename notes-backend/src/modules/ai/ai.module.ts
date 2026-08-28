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

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([{ name: AiRun.name, schema: AiRunSchema }]),
        forwardRef(() => KnowledgeBasesModule),
    ],
    controllers: [AiController],
    providers: [AiGatewayClient, AiService, AiRunService, AiProviderCapacityService],
    exports: [AiService, AiRunService, AiProviderCapacityService],
})
export class AiModule { }
