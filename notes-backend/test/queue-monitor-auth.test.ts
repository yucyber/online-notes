import { test } from 'node:test'
import assert = require('node:assert/strict')
import { RequestHandler } from 'express'
import { createQueueMonitorAuth } from '../src/modules/queue-monitor/queue-monitor-auth'

function invoke(handler: RequestHandler, authorization?: string) {
  const headers: Record<string, string> = {}
  let statusCode: number | undefined
  let nextCalled = false
  const request = { headers: { authorization } } as any
  const response = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    status(code: number) { statusCode = code; return this },
    send() { return this },
  } as any
  handler(request, response, () => { nextCalled = true })
  return { headers, get statusCode() { return statusCode }, get nextCalled() { return nextCalled } }
}

test('缺少或错误的 Bull Board 凭据统一返回 401', () => {
  const auth = createQueueMonitorAuth('operator', 'secret')
  for (const authorization of [undefined, `Basic ${Buffer.from('operator:wrong').toString('base64')}`]) {
    const result = invoke(auth, authorization)
    assert.equal(result.statusCode, 401)
    assert.equal(result.headers['www-authenticate'], 'Basic realm="AI Task Monitor"')
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.nextCalled, false)
  }
})

test('正确的 Bull Board 凭据放行且禁止缓存', () => {
  const auth = createQueueMonitorAuth('operator', 'secret')
  const result = invoke(auth, `Basic ${Buffer.from('operator:secret').toString('base64')}`)
  assert.equal(result.statusCode, undefined)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.nextCalled, true)
})
