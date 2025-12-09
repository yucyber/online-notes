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
        port: '3002',
        pathname: '/**',
      },
    ],
  },
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
}


module.exports = nextConfig
