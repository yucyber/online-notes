const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadJwtSecretFromEnvFile } = require('./env-utils')

test('loadJwtSecretFromEnvFile loads JWT_SECRET when no websocket secret is set', () => {
  const env = {}
  const result = loadJwtSecretFromEnvFile({
    env,
    envFile: path.join('tmp', 'notes-backend.env'),
    existsSync: () => true,
    readFileSync: () => 'JWT_SECRET=dev-secret\nPORT=3001\n',
  })

  assert.equal(env.JWT_SECRET, 'dev-secret')
  assert.deepEqual(result, {
    status: 'loaded',
    key: 'JWT_SECRET',
    envFile: path.join('tmp', 'notes-backend.env'),
  })
})

test('loadJwtSecretFromEnvFile keeps explicitly configured websocket secret', () => {
  const env = { YWS_JWT_SECRET: 'explicit-yws-secret' }
  const result = loadJwtSecretFromEnvFile({
    env,
    envFile: path.join('tmp', 'notes-backend.env'),
    existsSync: () => true,
    readFileSync: () => 'JWT_SECRET=dev-secret\n',
  })

  assert.equal(env.YWS_JWT_SECRET, 'explicit-yws-secret')
  assert.equal(env.JWT_SECRET, undefined)
  assert.deepEqual(result, { status: 'skipped', reason: 'secret-already-set' })
})
