import { saveAssistantNavigation, consumeAssistantNavigation, peekAssistantNavigation, clearAssistantNavigation } from '@/components/assistant/assistant-navigation'

beforeEach(() => sessionStorage.clear())

test('快照保存后可窥视，消费后清除', () => {
  const snapshot = { conversationId: 'c1', messageId: 'm1', contextPanelTab: 'citations' as const, expandedChunkIds: ['chunk-1'], savedAt: '2026-09-01T00:00:00.000Z' }
  saveAssistantNavigation(snapshot)
  expect(peekAssistantNavigation()?.conversationId).toBe('c1')
  expect(consumeAssistantNavigation()?.expandedChunkIds).toEqual(['chunk-1'])
  expect(consumeAssistantNavigation()).toBeNull()
})

test('损坏数据返回 null 且不抛错', () => {
  sessionStorage.setItem('assistant_navigation_snapshot_v1', '{bad json')
  expect(consumeAssistantNavigation()).toBeNull()
})

test('clear 清除快照', () => {
  saveAssistantNavigation({ conversationId: 'c1', contextPanelTab: 'info', expandedChunkIds: [], savedAt: '2026-09-01T00:00:00.000Z' })
  clearAssistantNavigation()
  expect(peekAssistantNavigation()).toBeNull()
})
