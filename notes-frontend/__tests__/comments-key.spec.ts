import { buildCommentIdempotencyKey } from '@/lib/comments-key'

// jest-environment-jsdom 未注入 WebCrypto subtle，注入 Node 原生实现供测试使用。
beforeAll(() => {
  const { webcrypto } = require('node:crypto')
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
})

describe('评论幂等键生成', () => {
  it('对同一参数产生稳定且符合后端字符集的键', async () => {
    const a = await buildCommentIdempotencyKey('abc123', 0, 5, '含中文评论')
    const b = await buildCommentIdempotencyKey('abc123', 0, 5, '含中文评论')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-z0-9]{40}$/)
  })

  it('不同文本产生不同键', async () => {
    const a = await buildCommentIdempotencyKey('abc123', 0, 5, '第一条')
    const b = await buildCommentIdempotencyKey('abc123', 0, 5, '第二条')
    expect(a).not.toBe(b)
  })

  it('冒号与中文不会进入最终键', async () => {
    const key = await buildCommentIdempotencyKey('a:b:c', 0, 5, '：中文：')
    expect(key).toMatch(/^[a-z0-9]{40}$/)
  })
})
