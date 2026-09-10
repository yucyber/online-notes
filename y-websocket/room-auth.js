const jwt = require('jsonwebtoken')

// room-ticket 由 notes-backend 的 POST /api/notes/:id/room-ticket 签发，
// payload 形如 { noteId, userId, role, type: 'room-ticket' }，TTL 300s。
const ROOM_TICKET_TYPE = 'room-ticket'

function extractToken(rawUrl) {
    if (!rawUrl) return ''
    try {
        const url = new URL(rawUrl, 'http://localhost')
        return url.searchParams.get('access_token') || url.searchParams.get('token') || ''
    } catch {
        return ''
    }
}

// 房间名即 URL 路径（去掉前导斜杠），前端约定为 `note:<noteId>[:<versionKey>]`。
function decodeRoomFromUrl(rawUrl) {
    if (!rawUrl) return ''
    let pathname
    try {
        pathname = new URL(rawUrl, 'http://localhost').pathname
    } catch {
        return ''
    }
    const raw = pathname.replace(/^\/+/, '')
    if (!raw) return ''
    try {
        return decodeURIComponent(raw)
    } catch {
        return raw
    }
}

// 票据必须绑定到它所声明的笔记：房间名只能是 note:<noteId> 或其 versionKey 变体。
// 这样即使攻击者持有"自己有权访问的笔记"的合法票据，也无法用它加入别人的房间。
function roomMatchesNote(room, noteId) {
    if (!room || noteId === undefined || noteId === null || noteId === '') return false
    const prefix = `note:${String(noteId).toLowerCase()}`
    const normalized = room.toLowerCase()
    return normalized === prefix || normalized.startsWith(`${prefix}:`)
}

// YWS_AUTH_DISABLED=1 只允许在非生产环境生效；生产环境忽略该开关（README 亦声明"生产环境禁止"）。
function isAuthDisabled(env = process.env) {
    const requested = String(env.YWS_AUTH_DISABLED || '').trim() === '1'
    if (!requested) return false
    if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') return false
    return true
}

// YWS_JWT_SECRET 优先；JWT_SECRET 作为兼容回退（start.js 会从 notes-backend/.env 载入）。
function resolveJwtSecret(env = process.env) {
    return env.YWS_JWT_SECRET || env.JWT_SECRET || ''
}

// 纯函数：把"这次 upgrade 请求该不该放行"的判定集中在一处，便于单测且不依赖网络。
// 返回 { ok: true, room, user, reason } 或 { ok: false, status, reason, room }
function authorizeUpgrade({ rawUrl, secret, authDisabled = false, verify } = {}) {
    const room = decodeRoomFromUrl(rawUrl)
    const token = extractToken(rawUrl)
    const verifyToken = verify || ((value, key) => jwt.verify(value, key))

    if (authDisabled) {
        return { ok: true, room, user: undefined, reason: 'auth-disabled' }
    }
    if (!token) {
        return { ok: false, status: 401, reason: 'missing-token', room }
    }
    if (!secret) {
        return { ok: false, status: 500, reason: 'missing-secret', room }
    }

    let payload
    try {
        payload = verifyToken(token, secret)
    } catch {
        return { ok: false, status: 401, reason: 'invalid-token', room }
    }
    if (!payload || typeof payload !== 'object') {
        return { ok: false, status: 401, reason: 'invalid-token', room }
    }
    // 只接受 room-ticket，避免把同一 secret 签出的登录 token 当作房间凭证复用。
    if (payload.type !== ROOM_TICKET_TYPE) {
        return { ok: false, status: 401, reason: 'wrong-ticket-type', room }
    }
    if (!roomMatchesNote(room, payload.noteId)) {
        return { ok: false, status: 401, reason: 'room-note-mismatch', room }
    }

    return { ok: true, room, user: payload, reason: 'ok' }
}

module.exports = {
    ROOM_TICKET_TYPE,
    authorizeUpgrade,
    decodeRoomFromUrl,
    extractToken,
    isAuthDisabled,
    resolveJwtSecret,
    roomMatchesNote,
}
