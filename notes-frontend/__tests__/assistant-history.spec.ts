import {
  routeAssistantMessage,
} from '@/components/ai/assistant-history'

beforeEach(() => localStorage.clear())

test('检索意图和强制搜索路由到 RAG，其余问题走 pet', () => {
  expect(routeAssistantMessage('帮我找之前 React Diff 的笔记', false)).toBe('rag')
  expect(routeAssistantMessage('今天心情不错', false)).toBe('pet')
  expect(routeAssistantMessage('今天心情不错', true)).toBe('rag')
})
