import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { AssistantCheckpointService } from './assistant-checkpoint.service'
import { AssistantContextService } from './assistant-context.service'
import { AssistantController } from './assistant.controller'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { MemoryCandidatesService } from './assistant-memory-candidates.service'
import { AssistantMemoryExtractorService } from './assistant-memory-extractor.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantConversation, AssistantConversationSchema } from './schemas/assistant-conversation.schema'
import { AssistantMessage, AssistantMessageSchema } from './schemas/assistant-message.schema'
import { AssistantContextCheckpoint, AssistantCheckpointSchema } from './schemas/assistant-checkpoint.schema'
import { AssistantMemoryCandidate, AssistantMemoryCandidateSchema } from './schemas/assistant-memory-candidate.schema'
import { AssistantMemory, AssistantMemorySchema } from './schemas/assistant-memory.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantMessage.name, schema: AssistantMessageSchema },
      { name: AssistantContextCheckpoint.name, schema: AssistantCheckpointSchema },
      { name: AssistantMemoryCandidate.name, schema: AssistantMemoryCandidateSchema },
      { name: AssistantMemory.name, schema: AssistantMemorySchema },
    ]),
    // forwardRef：AiModule 不反向依赖 assistant，此处预防未来阶段双向依赖（RagStreamService 从 AiModule 注入）。
    forwardRef(() => AiModule),
  ],
  controllers: [AssistantController],
  // 记忆候选/提取器依赖的 schema 已在上方 forFeature 注册；generation 对提取器的 @Optional
  // 注入在 provider 注册后自动生效（fire-and-forget 提取不再空转）。MEMORY_RECALL_SERVICE 留待后续任务注册。
  providers: [
    AssistantConversationsService, AssistantMessagesService, AssistantGenerationService,
    AssistantCheckpointService, AssistantContextService, AssistantMemoryExtractorService,
    MemoryCandidatesService,
  ],
  exports: [AssistantConversationsService, AssistantMessagesService],
})
export class AssistantModule { }
