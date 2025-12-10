import { Metadata } from 'next'
import { Suspense } from 'react'

export const metadata: Metadata = {
  title: '登录 - 在线知识笔记平台',
  description: '登录您的账户以访问在线知识笔记平台',
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">加载中...</div>}>
      {children}
    </Suspense>
  )
}
