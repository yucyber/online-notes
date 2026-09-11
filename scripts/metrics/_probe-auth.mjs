import { pickUser, mintToken, API } from './_auth.mjs'
const { user, close } = await pickUser()
console.log('user:', user.email, String(user._id), 'roles:', JSON.stringify(user.roles ?? null))
const token = mintToken(user)
const res = await fetch(`${API}/notes?page=1&size=1`, { headers: { Authorization: `Bearer ${token}` } })
console.log('GET /api/notes status:', res.status)
const body = await res.json().catch(() => null)
console.log('envelope code:', body?.code, 'message:', body?.message, 'items:', body?.data?.items?.length ?? body?.data?.total ?? 'n/a')
await close()
