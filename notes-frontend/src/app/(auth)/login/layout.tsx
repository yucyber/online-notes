import { Metadata } from 'next'

export const metadata: Metadata = {
  title: '登录 - 在线知识笔记平台',
  description: '登录您的账户以访问在线知识笔记平台',
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}