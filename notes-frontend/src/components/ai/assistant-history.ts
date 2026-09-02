// 小助手路由判定：NOTE_INTENT 命中或手动"搜索笔记"开关 → rag；否则 pet。
// 历史消息存储已迁移到服务端（assistant_messages），旧的 localStorage 历史函数已随迁移删除。
const NOTE_INTENT = /(我的笔记|笔记里|之前|当时|踩坑|查找|找到|搜索|哪篇|比较|区别|差异|冲突|矛盾|知识库)/i

export type AssistantRoute = 'pet' | 'rag'

export function routeAssistantMessage(content: string, forceNotes: boolean): AssistantRoute {
  return forceNotes || NOTE_INTENT.test(content) ? 'rag' : 'pet'
}
