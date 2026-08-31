// Node 侧直连后端的 baseURL：必须用 127.0.0.1 而非 localhost，
// Windows 下 Node 解析 localhost 优先返回 IPv6 ::1，而后端只监听 IPv4 的 0.0.0.0:3001，
// 会报 ECONNREFUSED ::1:3001（与 next.config.js rewrite 的坑一致）。
// 不要复用 NEXT_PUBLIC_API_URL：那是给浏览器的，必须保持 localhost 才能与页面同 site，
// 否则 SameSite=Lax 的登录 cookie 不会随请求发送。
// 远程部署时可用 SERVER_API_URL 覆盖（如指向线上后端）。
export const SERVER_API_URL = process.env.SERVER_API_URL || 'http://127.0.0.1:3001/api'
