const { test } = require('node:test')
const assert = require('node:assert/strict')
const { shouldDropMessage } = require('./read-only')

test('reader drops Yjs sync updates but can receive initial sync and awareness', () => {
  assert.equal(shouldDropMessage(Buffer.from([0, 2]), 'reader'), true)
  assert.equal(shouldDropMessage(Buffer.from([0, 1]), 'reader'), true)
  assert.equal(shouldDropMessage(Buffer.from([0, 0]), 'reader'), false)
  assert.equal(shouldDropMessage(Buffer.from([1, 0]), 'reader'), false)
})

test('writer messages are not filtered', () => {
  assert.equal(shouldDropMessage(Buffer.from([0, 2]), 'writer'), false)
})
