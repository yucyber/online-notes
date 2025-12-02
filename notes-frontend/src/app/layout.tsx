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
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased" style={{ background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f9fafb)', backgroundColor: '#f9fafb' }}>
        {children}
      </body>
    </html>
  )
}