import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AuthController } from '../src/modules/auth/auth.controller'

test('生产 Cookie 默认 Secure，仅显式 HTTP 部署允许关闭', async () => {
  const previousNode = process.env.NODE_ENV
  const previousSecure = process.env.COOKIE_SECURE
  try {
    process.env.NODE_ENV = 'production'
    const controller = new AuthController({ login: async () => ({ token: 'test', user: {} }) } as any)
    for (const [value, expected] of [[undefined, true], ['false', false], ['true', true]] as const) {
      if (value === undefined) delete process.env.COOKIE_SECURE
      else process.env.COOKIE_SECURE = value
      let options: any
      await controller.login({} as any, { cookie: (_name: string, _token: string, opts: any) => { options = opts } } as any)
      assert.equal(options.secure, expected)
      assert.equal(options.httpOnly, true)
      assert.equal(options.sameSite, 'lax')
    }
  } finally {
    if (previousNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNode
    if (previousSecure === undefined) delete process.env.COOKIE_SECURE
    else process.env.COOKIE_SECURE = previousSecure
  }
})
