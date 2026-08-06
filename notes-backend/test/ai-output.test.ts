import { test } from 'node:test'
import assert = require('node:assert/strict')
import { extractJsonObject, parseJsonObject, stripCodeFence } from '../src/modules/ai/ai-output'

test('stripCodeFence removes json and mermaid fences', () => {
  assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripCodeFence('```mermaid\nflowchart TD\nA-->B\n```'), 'flowchart TD\nA-->B')
})

test('extractJsonObject slices the outermost object', () => {
  assert.equal(extractJsonObject('prefix {"a":1,"b":2} suffix'), '{"a":1,"b":2}')
  assert.equal(extractJsonObject('no object here'), null)
})

test('parseJsonObject parses fenced AI JSON', () => {
  assert.deepEqual(parseJsonObject('```json\n{"nodes":[]}\n```'), { nodes: [] })
})
