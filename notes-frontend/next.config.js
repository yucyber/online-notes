/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  // eslint: { ignoreDuringBuilds: true },
  // 使用的 Next.js 版本是 14.2.33，它还不认识 experimental.allowedDevOrigins 这个键。运行 next dev 时会提示 “Invalid next.config.js options… Unrecognized key(s): 'allowedDevOrigins'”，说明这段配置不会生效，只是被忽略了。该选项预计在 Next 15 才会真正启用，所以 14.x 里不能依靠它解决跨域提示。
  // experimental: {
  //   allowedDevOrigins: ['http://10.34.145.130:3000'],
  // },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/**',
      },
    ],
  },
  // 使用 Next.js 默认输出目录 `.next`，以兼容 Vercel 的构建产物探测

  // 生产构建临时放宽校验，避免 ESLint/TypeScript 在缓存目录写入时触发文件系统权限问题（EPERM）
  // 后续在 CI 中执行 `next lint` 和 `tsc --noEmit`，保障质量门禁
  // eslint: { ignoreDuringBuilds: true }, // Next.js 15+ deprecated this in config, use --no-lint flag instead
  typescript: { ignoreBuildErrors: true },
  outputFileTracingRoot: __dirname,
  env: {
    // 浏览器侧 baseURL 必须用 localhost：页面在 http://localhost:3000，若用 127.0.0.1 则跨 site，
    // 后端 SameSite=Lax 的登录 cookie 不再随请求发送，会导致登录成功后立即 401 跳回登录页（循环）。
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
    // 可选：RUM 上报端点，若未配置则前端仅本地调试输出
    NEXT_PUBLIC_RUM_ENDPOINT: process.env.NEXT_PUBLIC_RUM_ENDPOINT || '',
    NEXT_PUBLIC_YWS_URL: process.env.NEXT_PUBLIC_YWS_URL,
  },
  async rewrites() {
    // 容器构建使用内部 backend 地址；本地保留 IPv4 回退，避免 localhost 被解析到 ::1。
    // 浏览器公开地址不能用作 Docker 内部代理目标。
    const backendOrigin = (process.env.SERVER_API_URL || 'http://127.0.0.1:3001/api').replace(/\/api\/?$/, '')
    return [
      {
        // assistant 有独立的 app route handler（app/api/assistant/[...path]/route.ts），负责 SSE 流式透传、
        // JSON 信封解包与 cookie→Bearer 认证。这里用负向前瞻排除 /api/assistant 前缀，避免被下面的
        // catch-all rewrite 接管——否则 Next dev 下 rewrite 会把后端 SSE 缓冲成整块，小助手回答整段跳出。
        // 其余 /api/* 仍走 rewrite 直连后端。
        source: '/api/:path((?!assistant(?:/|$)).*)',
        destination: `${backendOrigin}/api/:path*`,
      },
    ]
  },
  // 针对 Windows 的输出文件追踪根路径限定，减少跨盘/受限目录扫描导致的权限异常
  // 注意：如仍出现 EPERM，可考虑在本地构建时暂时禁用输出追踪（仅用于诊断，不建议长期关闭）
  // experimental: {
  //   allowedDevOrigins: ['http://10.34.145.130:3000'], // 14.x 不支持，保留注释
  //   outputFileTracingRoot: __dirname,
  // },
}


module.exports = nextConfig
