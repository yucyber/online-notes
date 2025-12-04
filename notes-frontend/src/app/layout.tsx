import './globals.css'

export const metadata = {
  title: '在线知识笔记平台',
  description: '专业的知识管理和笔记工具，支持Markdown编辑、分类管理、多端同步',
  keywords: '笔记,知识管理,Markdown,在线笔记,知识库',
  authors: [{ name: '在线知识笔记平台团队' }],
  icons: {
    icon: '/favicon.ico',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
  const apiOrigin = apiUrl.replace(/\/(api|v\d+).*/, '')
  return (
    <html lang="zh-CN">
      <head>
        {/* 预连接后端 API，降低首包请求握手与 DNS 延迟 */}
        <link rel="preconnect" href={apiOrigin} />
        <link rel="dns-prefetch" href={apiOrigin} />
      </head>
      <body className="min-h-screen antialiased bg-white">
        {children}
      </body>
    </html>
  )
}
