import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { AssistantConversationSchema } from '../src/modules/assistant/schemas/assistant-conversation.schema'
import { AssistantMessageSchema } from '../src/modules/assistant/schemas/assistant-message.schema'

test('会话 schema 声明 userId/status 等关键字段与默认值', () => {
  assert.equal(AssistantConversationSchema.path('userId').instance, 'ObjectId')
  assert.equal(AssistantConversationSchema.path('status').options.default, 'active')
  assert.equal(AssistantConversationSchema.path('messageCount').options.default, 0)
  assert.equal(AssistantConversationSchema.path('defaultRoute').options.default, 'auto')
})

test('消息 schema 的 seq/requestId 唯一索引与状态枚举', () => {
  assert.equal(AssistantMessageSchema.path('seq').options.required, true)
  assert.equal(AssistantMessageSchema.path('status').options.enum.includes('cancelled'), true)
  const index = AssistantMessageSchema.indexes()
  assert.ok(index.some(([fields]) => fields.conversationId === 1 && fields.seq === 1))
  assert.ok(index.some(([fields]) => fields.userId === 1 && fields.requestId === 1))
})
