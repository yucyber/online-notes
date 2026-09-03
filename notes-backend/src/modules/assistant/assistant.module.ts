import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { MEMORY_RECALL_SERVICE } from './assistant.constants'
import { AssistantCheckpointService } from './assistant-checkpoint.service'
import { AssistantContextService } from './assistant-context.service'
import { AssistantController } from './assistant.controller'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { MemoryCandidatesService } from './assistant-memory-candidates.service'
import { AssistantMemoryExtractorService } from './assistant-memory-extractor.service'
import { MemoryRecallService } from './assistant-memory-recall.service'
import { MemoryService } from './assistant-memory.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantConversation, AssistantConversationSchema } from './schemas/assistant-conversation.schema'
import { AssistantMessage, AssistantMessageSchema } from './schemas/assistant-message.schema'
import { AssistantContextCheckpoint, AssistantCheckpointSchema } from './schemas/assistant-checkpoint.schema'
import { AssistantMemoryCandidate, AssistantMemoryCandidateSchema } from './schemas/assistant-memory-candidate.schema'
import { AssistantMemory, AssistantMemorySchema } from './schemas/assistant-memory.schema'
import { NoteChunk, NoteChunkSchema } from '../notes/schemas/note-chunk.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantMessage.name, schema: AssistantMessageSchema },
      { name: AssistantContextCheckpoint.name, schema: AssistantCheckpointSchema },
      { name: AssistantMemoryCandidate.name, schema: AssistantMemoryCandidateSchema },
      { name: AssistantMemory.name, schema: AssistantMemorySchema },
      // 证据复核需校验 note_chunk 证据是否仍存在：NoteChunk 已由 notes/semantic/knowledge-bases 注册
      // （@nestjs/mongoose 按 connection.models 缓存复用），此处再注册幂等，MemoryService 的 @InjectModel 才在生产 DI 解析。
      { name: NoteChunk.name, schema: NoteChunkSchema },
    ]),
    // forwardRef：AiModule 不反向依赖 assistant，此处预防未来阶段双向依赖（RagStreamService 从 AiModule 注入）。
    forwardRef(() => AiModule),
  ],
  controllers: [AssistantController],
  // 记忆候选/提取器/演进/召回依赖的 schema 已在上方 forFeature 注册；generation 对提取器的 @Optional
  // 注入在 provider 注册后自动生效（fire-and-forget 提取不再空转）。MEMORY_RECALL_SERVICE 注册后
  // assistant-context.service 的 @Optional 注入即拿到真实实例，assemble 输出 [已确认认知] 分区。
  providers: [
    AssistantConversationsService, AssistantMessagesService, AssistantGenerationService,
    AssistantCheckpointService, AssistantContextService, AssistantMemoryExtractorService,
    MemoryCandidatesService, MemoryService,
    { provide: MEMORY_RECALL_SERVICE, useClass: MemoryRecallService },
  ],
  exports: [AssistantConversationsService, AssistantMessagesService, MEMORY_RECALL_SERVICE],
})
export class AssistantModule { }
