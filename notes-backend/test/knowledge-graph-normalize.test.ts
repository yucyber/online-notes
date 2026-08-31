import assert = require('node:assert/strict')
import { test } from 'node:test'
import {
  clampUnitInterval,
  normalizeKnowledgeGraphRelation,
  normalizeKnowledgeGraphNodeType,
  normalizeKnowledgeGraphNoteIds,
  resolveKnowledgeGraphEdgeNoteIds,
  uniqueStrings,
} from '../src/modules/knowledge-bases/knowledge-graph-normalize'

test('normalizeKnowledgeGraphNodeType maps unknown values to concept', () => {
  assert.equal(normalizeKnowledgeGraphNodeType('entity'), 'entity')
  assert.equal(normalizeKnowledgeGraphNodeType('TOPIC'), 'topic')
  assert.equal(normalizeKnowledgeGraphNodeType('claim'), 'claim')
  assert.equal(normalizeKnowledgeGraphNodeType('other'), 'concept')
  assert.equal(normalizeKnowledgeGraphNodeType(null), 'concept')
})

test('normalizeKnowledgeGraphRelation uses the Chinese fallback for missing values', () => {
  assert.equal(normalizeKnowledgeGraphRelation(undefined), '相关')
  assert.equal(normalizeKnowledgeGraphRelation('  支持  '), '支持')
})

test('normalizeKnowledgeGraphNoteIds keeps only allowed unique ids', () => {
  const allowed = new Set(['a', 'b'])
  assert.deepEqual(
    normalizeKnowledgeGraphNoteIds(['a', 'a', 'c', ' b ', null], allowed),
    ['a', 'b'],
  )
})

test('resolveKnowledgeGraphEdgeNoteIds prefers explicit then fallback within allowlist', () => {
  const allowed = new Set(['a', 'b', 'c'])
  assert.deepEqual(
    resolveKnowledgeGraphEdgeNoteIds(['c', 'x'], allowed, ['a', 'b']),
    ['c'],
  )
  assert.deepEqual(
    resolveKnowledgeGraphEdgeNoteIds([], allowed, ['a', 'x', 'b', 'a']),
    ['a', 'b'],
  )
})

test('clampUnitInterval and uniqueStrings stay bounded', () => {
  assert.equal(clampUnitInterval(1.5, 0.5), 1)
  assert.equal(clampUnitInterval(-1, 0.5), 0)
  assert.equal(clampUnitInterval('x', 0.75), 0.75)
  assert.deepEqual(uniqueStrings(['a', '', 'a', 'b']), ['a', 'b'])
})
