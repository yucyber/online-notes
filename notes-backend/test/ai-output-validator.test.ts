import assert = require('node:assert/strict')
import { test } from 'node:test'

import { validateAiOutput } from '../src/modules/ai/ai-output-validator'

test('accepts non-empty text and rejects blank assistant content', () => {
  assert.deepEqual(validateAiOutput('writer', 'useful text'), { valid: true })
  assert.deepEqual(validateAiOutput('writer', '  '), { valid: false, reason: 'empty_content' })
})

test('requires graph nodes and edges arrays', () => {
  assert.deepEqual(validateAiOutput('knowledge_graph', '{"nodes":[],"edges":[]}'), { valid: true })
  assert.deepEqual(validateAiOutput('knowledge_graph', '{"nodes":{}}'), { valid: false, reason: 'invalid_output' })
  assert.deepEqual(validateAiOutput('knowledge_graph', 'not json'), { valid: false, reason: 'invalid_output' })
})

test('rejects organizer actions outside the contract or note scope', () => {
  assert.deepEqual(validateAiOutput(
    'organizer_proposal',
    '{"actions":[{"type":"add_tag","noteIds":["n1"]}]}',
    { allowedNoteIds: ['n1'] },
  ), { valid: true })
  assert.deepEqual(validateAiOutput(
    'organizer_proposal',
    '{"actions":[{"type":"delete_note","noteIds":["n1"]}]}',
    { allowedNoteIds: ['n1'] },
  ), { valid: false, reason: 'invalid_output' })
  assert.deepEqual(validateAiOutput(
    'organizer_proposal',
    '{"actions":[{"type":"add_tag","noteIds":["other"]}]}',
    { allowedNoteIds: ['n1'] },
  ), { valid: false, reason: 'invalid_output' })
})
