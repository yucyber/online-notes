import './globals.css'
import 'tippy.js/dist/tippy.css'
import '@/styles/editor-tokens.css'
import RUMClient from '@/components/rum/RUMClient'
import { AIProvider } from '@/context/AIContext'

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
    <html lang="zh-CN" data-theme="editor-light" suppressHydrationWarning>
      <head>
        {/* 预连接后端 API，降低首包请求握手与 DNS 延迟 */}
        <link rel="preconnect" href={apiOrigin} />
        <link rel="dns-prefetch" href={apiOrigin} />
        {/* 主题预置：在水合前应用，避免闪烁 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{var t=localStorage.getItem('theme');var prefers=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var dark=(t? t==='dark' : prefers);var el=document.documentElement; if(dark){el.classList.add('dark'); el.setAttribute('data-theme','dark');} else {el.classList.remove('dark'); el.setAttribute('data-theme','editor-light');}}catch(e){}})();`
          }}
        />
      </head>
      <body className="min-h-screen antialiased bg-white">
        <AIProvider>
          {children}
        </AIProvider>
        {/* RUM 注入：在全局布局挂载轻量 Web Vitals 采集 */}
        <RUMClient />
      </body>
    </html>
  )
}
