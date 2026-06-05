import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiController } from './ai.controller';
import { AiGatewayClient } from './ai-gateway.client';
import { AiRunService } from './ai-run.service';
import { AiService } from './ai.service';
import { AggregateSummaryGraph } from './graphs/aggregate-summary.graph';
import { AiRun, AiRunSchema } from './schemas/ai-run.schema';

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([{ name: AiRun.name, schema: AiRunSchema }]),
    ],
    controllers: [AiController],
    providers: [AiGatewayClient, AiService, AiRunService, AggregateSummaryGraph],
    exports: [AiService, AiRunService],
})
export class AiModule { }
