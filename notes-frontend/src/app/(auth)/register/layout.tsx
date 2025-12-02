import { Metadata } from 'next'

export const metadata: Metadata = {
  title: '注册 - 在线知识笔记平台',
  description: '创建新账户以开始使用在线知识笔记平台',
}

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}