import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { AssistantController } from './assistant.controller'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantConversation, AssistantConversationSchema } from './schemas/assistant-conversation.schema'
import { AssistantMessage, AssistantMessageSchema } from './schemas/assistant-message.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantMessage.name, schema: AssistantMessageSchema },
    ]),
    // forwardRef：AiModule 不反向依赖 assistant，此处预防未来阶段双向依赖（RagStreamService 从 AiModule 注入）。
    forwardRef(() => AiModule),
  ],
  controllers: [AssistantController],
  providers: [AssistantConversationsService, AssistantMessagesService, AssistantGenerationService],
  exports: [AssistantConversationsService, AssistantMessagesService],
})
export class AssistantModule { }
