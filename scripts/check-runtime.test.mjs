import assert from 'node:assert/strict'
import test from 'node:test'

import { checkRuntime } from './check-runtime.mjs'

test('rejects Node versions outside 22.x', () => {
  const result = checkRuntime({
    nodeVersion: '21.7.3',
    rootFiles: ['package-lock.json'],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /Node\.js 22\.x/)
})

test('rejects workspace pnpm lockfiles', () => {
  const result = checkRuntime({
    nodeVersion: '22.22.3',
    rootFiles: ['package-lock.json', 'pnpm-lock.yaml'],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /pnpm-lock\.yaml/)
})

test('accepts Node 22 with the root npm lockfile only', () => {
  assert.deepEqual(checkRuntime({
    nodeVersion: '22.22.3',
    rootFiles: ['package-lock.json'],
  }), { ok: true, errors: [] })
})
