import assert = require('node:assert/strict')
import { test } from 'node:test'

import { buildProviderOptions } from '../src/modules/ai/ai-provider-adapter'

test('disables thinking for SiliconFlow Qwen in off mode', () => {
  assert.deepEqual(buildProviderOptions({
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-14B',
    reasoningMode: 'off',
  }), { enable_thinking: false })
})

test('enables thinking for SiliconFlow DeepSeek in deep mode', () => {
  assert.deepEqual(buildProviderOptions({
    provider: 'siliconflow',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    reasoningMode: 'deep',
  }), { enable_thinking: true })
})

test('does not guess unsupported reasoning parameters', () => {
  assert.deepEqual(buildProviderOptions({
    provider: 'bai',
    model: 'deepseek-v4-flash',
    reasoningMode: 'off',
  }), {})
  assert.deepEqual(buildProviderOptions({
    provider: 'ar',
    model: 'claude-opus-4-8',
    reasoningMode: 'deep',
  }), {})
})
