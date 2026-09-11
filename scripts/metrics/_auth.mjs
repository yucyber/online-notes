// 用 backend 的 JWT_SECRET 为 test db 中的真实用户签发访问令牌（仅用于本地测量）
import { MongoClient, jwt, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })

export const DB = 'test' // MONGODB_URI 无 db 段 → 驱动默认 test（app 实际使用的库）

export async function pickUser(email) {
  const c = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  const users = c.db(DB).collection('users')
  const user = email ? await users.findOne({ email }) : await users.findOne({})
  if (!user) { await c.close(); throw new Error('no user found') }
  return { user, client: c, close: () => c.close() }
}

export function mintToken(user) {
  return jwt.sign({ email: user.email, sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '2h' })
}

export const API = 'http://127.0.0.1:3001/api'
