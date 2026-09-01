import {
  ASSISTANT_HISTORY_KEY,
  loadAssistantHistory,
  routeAssistantMessage,
  saveAssistantHistory,
} from '@/components/ai/assistant-history'

beforeEach(() => localStorage.clear())

test('统一历史只保留最近 100 条合法消息', () => {
  const messages = Array.from({ length: 105 }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 ? 'assistant' as const : 'user' as const,
    content: `message-${index}`,
    route: 'pet' as const,
    createdAt: new Date(index).toISOString(),
  }))

  saveAssistantHistory(localStorage, messages)

  const restored = loadAssistantHistory(localStorage)
  expect(restored).toHaveLength(100)
  expect(restored[0].content).toBe('message-5')
})

test('旧 pet 和 rag 历史迁移到统一历史并清理旧 key', () => {
  localStorage.setItem('ai_pet_history', JSON.stringify([{ role: 'user', content: '你好' }]))
  localStorage.setItem('ai_rag_history', JSON.stringify([{ role: 'assistant', content: 'React [E1]', result: { answer: 'React [E1]', citations: [], warnings: [], planSummary: {} } }]))

  const restored = loadAssistantHistory(localStorage)

  expect(restored.map((message) => message.route)).toEqual(['pet', 'rag'])
  expect(localStorage.getItem(ASSISTANT_HISTORY_KEY)).toContain('React')
  expect(localStorage.getItem('ai_pet_history')).toBeNull()
  expect(localStorage.getItem('ai_rag_history')).toBeNull()
})

test('检索意图和强制搜索路由到 RAG，其余问题走 pet', () => {
  expect(routeAssistantMessage('帮我找之前 React Diff 的笔记', false)).toBe('rag')
  expect(routeAssistantMessage('今天心情不错', false)).toBe('pet')
  expect(routeAssistantMessage('今天心情不错', true)).toBe('rag')
})
