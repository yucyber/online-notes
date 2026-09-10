const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  authorizeUpgrade,
  decodeRoomFromUrl,
  extractToken,
  isAuthDisabled,
  roomMatchesNote,
} = require('./room-auth')

const NOTE_ID = '68c1f0aabbccddeeff001122'
const OTHER_NOTE_ID = '68c1f0aabbccddeeff003344'
const SECRET = 'test-secret'

// 模拟 jwt.verify：按签名好的 payload 直接返回，便于纯逻辑测试
const verifyReturning = (payload) => () => payload

test('decodeRoomFromUrl 取路径并解码，忽略 query', () => {
  assert.equal(decodeRoomFromUrl('/note:abc?access_token=x'), 'note:abc')
  assert.equal(decodeRoomFromUrl('/note%3Aabc'), 'note:abc')
  assert.equal(decodeRoomFromUrl('/'), '')
  assert.equal(decodeRoomFromUrl(''), '')
})

test('extractToken 支持 access_token 与 token 两种参数名', () => {
  assert.equal(extractToken('/note:a?access_token=t1'), 't1')
  assert.equal(extractToken('/note:a?token=t2'), 't2')
  assert.equal(extractToken('/note:a'), '')
})

test('roomMatchesNote 只接受 note:<noteId> 及其 versionKey 变体，且大小写不敏感', () => {
  assert.equal(roomMatchesNote(`note:${NOTE_ID}`, NOTE_ID), true)
  assert.equal(roomMatchesNote(`note:${NOTE_ID}:v2`, NOTE_ID), true)
  assert.equal(roomMatchesNote(`note:${NOTE_ID.toUpperCase()}`, NOTE_ID), true)
  // 前缀相同但 noteId 不同的房间不能被放行
  assert.equal(roomMatchesNote(`note:${OTHER_NOTE_ID}`, NOTE_ID), false)
  assert.equal(roomMatchesNote('note:', NOTE_ID), false)
  assert.equal(roomMatchesNote('stress-test-room', NOTE_ID), false)
  assert.equal(roomMatchesNote(`note:${NOTE_ID}`, undefined), false)
})

test('合法 room-ticket 且房间匹配时放行，并透出 user', () => {
  const payload = { noteId: NOTE_ID, userId: 'u1', role: 'reader', type: 'room-ticket' }
  const result = authorizeUpgrade({
    rawUrl: `/note:${NOTE_ID}?access_token=t`,
    secret: SECRET,
    verify: verifyReturning(payload),
  })
  assert.equal(result.ok, true)
  assert.equal(result.user, payload)
  assert.equal(result.room, `note:${NOTE_ID}`)
})

test('登录 token（type 不是 room-ticket）即使签名有效也被拒绝', () => {
  const loginPayload = { sub: 'u1', email: 'a@b.c' }
  const result = authorizeUpgrade({
    rawUrl: `/note:${NOTE_ID}?access_token=t`,
    secret: SECRET,
    verify: verifyReturning(loginPayload),
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.equal(result.reason, 'wrong-ticket-type')
})

test('票据 noteId 与房间不一致时必须拒绝（跨笔记读防护）', () => {
  const payload = { noteId: NOTE_ID, userId: 'u1', role: 'reader', type: 'room-ticket' }
  const result = authorizeUpgrade({
    rawUrl: `/note:${OTHER_NOTE_ID}?access_token=t`,
    secret: SECRET,
    verify: verifyReturning(payload),
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.equal(result.reason, 'room-note-mismatch')
})

test('缺失 token / 签名无效 / 缺 secret 分别返回 401、401、500', () => {
  assert.equal(authorizeUpgrade({ rawUrl: `/note:${NOTE_ID}`, secret: SECRET }).reason, 'missing-token')
  assert.equal(
    authorizeUpgrade({ rawUrl: `/note:${NOTE_ID}?access_token=bad`, secret: SECRET }).status,
    401,
  )
  assert.equal(
    authorizeUpgrade({ rawUrl: `/note:${NOTE_ID}?access_token=t`, secret: '' }).reason,
    'missing-secret',
  )
  assert.equal(
    authorizeUpgrade({ rawUrl: `/note:${NOTE_ID}?access_token=t`, secret: '' }).status,
    500,
  )
})

test('verify 抛错时不泄漏异常，统一按 401 处理', () => {
  const result = authorizeUpgrade({
    rawUrl: `/note:${NOTE_ID}?access_token=t`,
    secret: SECRET,
    verify: () => { throw new Error('jwt expired') },
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.equal(result.reason, 'invalid-token')
})

test('YWS_AUTH_DISABLED=1 仅在非生产环境生效', () => {
  assert.equal(isAuthDisabled({ YWS_AUTH_DISABLED: '1' }), true)
  assert.equal(isAuthDisabled({ YWS_AUTH_DISABLED: '1', NODE_ENV: 'development' }), true)
  assert.equal(isAuthDisabled({ YWS_AUTH_DISABLED: '1', NODE_ENV: 'production' }), false)
  assert.equal(isAuthDisabled({}), false)
  assert.equal(isAuthDisabled({ YWS_AUTH_DISABLED: '0' }), false)
})

test('auth-disabled 时放行任意房间（仅开发环境语义）', () => {
  const result = authorizeUpgrade({ rawUrl: '/stress-test-room', authDisabled: true })
  assert.equal(result.ok, true)
  assert.equal(result.reason, 'auth-disabled')
  assert.equal(result.user, undefined)
})
