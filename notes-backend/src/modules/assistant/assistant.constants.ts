// 认知召回注入令牌：assistant.module 注册 provider（MemoryRecallService 实现），context/generation 均按需 @Optional 注入。
// 未注册/未注入时为 undefined，assemble 缺省不输出 [已确认认知] 分区；注册后分区与 [M1] 引用按召回结果生效。
export const MEMORY_RECALL_SERVICE = Symbol('MEMORY_RECALL_SERVICE')

export interface MemoryRecallServiceLike {
  recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }): Promise<Array<{ label: string; text: string }>>
}

// 认知记忆类型（阶段四）：与笔记/会话检索区分，仅供记忆候选与长期记忆使用。
export type MemoryKind = 'decision' | 'preference' | 'fact' | 'hypothesis' | 'open_question' | 'constraint' | 'lesson'

export type MemoryScope = { type: 'global' | 'knowledge_base' | 'note' | 'conversation'; id?: string }

export type MemoryEvidence =
  | { type: 'message'; messageId: string; excerpt: string }
  | { type: 'note_chunk'; noteId: string; chunkId: string; excerpt: string }

export type MemoryRelationType = 'supports' | 'contradicts' | 'supersedes' | 'refines'

export const MEMORY_KINDS: MemoryKind[] = ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson']
