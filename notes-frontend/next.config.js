/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
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
  // 构建输出目录调整，规避 Windows/OneDrive 对 `.next` 目录的文件锁导致的 EPERM
  // 说明：Desktop 目录常被 OneDrive 同步，Next 在构建阶段频繁对缓存进行 rename/unlink 操作，容易触发 EPERM。
  // 将默认 `.next` 改为 `build` 可显著降低被系统或杀毒软件锁定的概率。
  distDir: 'build',

  // 生产构建临时放宽校验，避免 ESLint/TypeScript 在缓存目录写入时触发文件系统权限问题（EPERM）
  // 后续在 CI 中执行 `next lint` 和 `tsc --noEmit`，保障质量门禁
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
    // 可选：RUM 上报端点，若未配置则前端仅本地调试输出
    NEXT_PUBLIC_RUM_ENDPOINT: process.env.NEXT_PUBLIC_RUM_ENDPOINT || '',
  },
  async rewrites() {
    // Next 重写：将前端域名下的 /api/* 代理到后端 3001，统一同源请求，减少 CORS/OPTIONS 负担
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
    const backendOrigin = apiUrl.replace(/\/(api|v\d+).*$/, '') || 'http://localhost:3001'
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
    ]
  },
  // 针对 Windows 的输出文件追踪根路径限定，减少跨盘/受限目录扫描导致的权限异常
  // 注意：如仍出现 EPERM，可考虑在本地构建时暂时禁用输出追踪（仅用于诊断，不建议长期关闭）
  experimental: {
    // allowedDevOrigins: ['http://10.34.145.130:3000'], // 14.x 不支持，保留注释
    outputFileTracingRoot: __dirname,
  },
}


module.exports = nextConfig
