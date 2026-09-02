// 阶段四实现记忆召回服务时注册 provider；本阶段只提供 symbol 与接口，
// @Optional 注入为 undefined，assemble 缺省不输出 [已确认认知] 分区。
export const MEMORY_RECALL_SERVICE = Symbol('MEMORY_RECALL_SERVICE')

export interface MemoryRecallServiceLike {
  recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }): Promise<Array<{ label: string; text: string }>>
}
