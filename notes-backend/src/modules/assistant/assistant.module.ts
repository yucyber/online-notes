import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { AssistantCheckpointService } from './assistant-checkpoint.service'
import { AssistantContextService } from './assistant-context.service'
import { AssistantController } from './assistant.controller'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantConversation, AssistantConversationSchema } from './schemas/assistant-conversation.schema'
import { AssistantMessage, AssistantMessageSchema } from './schemas/assistant-message.schema'
import { AssistantContextCheckpoint, AssistantCheckpointSchema } from './schemas/assistant-checkpoint.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantMessage.name, schema: AssistantMessageSchema },
      { name: AssistantContextCheckpoint.name, schema: AssistantCheckpointSchema },
    ]),
    // forwardRef：AiModule 不反向依赖 assistant，此处预防未来阶段双向依赖（RagStreamService 从 AiModule 注入）。
    forwardRef(() => AiModule),
  ],
  controllers: [AssistantController],
  // AssistantContextService 依赖 messages/checkpoints（同模块直接注入）；MEMORY_RECALL_SERVICE 阶段四才注册 provider。
  providers: [AssistantConversationsService, AssistantMessagesService, AssistantGenerationService, AssistantCheckpointService, AssistantContextService],
  exports: [AssistantConversationsService, AssistantMessagesService],
})
export class AssistantModule { }
