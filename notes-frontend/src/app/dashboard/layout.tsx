'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  FileText,
  Bookmark,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Settings2
} from 'lucide-react'
import NetworkStatus from '@/components/security/NetworkStatus'
import { getCurrentUser, isAuthenticated, removeToken } from '@/lib/auth'
import type { User } from '@/types'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  // 导航按钮统一样式，根据激活/悬停状态返回不同的渐变与阴影
  const getNavButtonStyle = (isActive: boolean, isHovered: boolean) => {
    const base = {
      borderRadius: '18px',
      padding: '0 18px',
      border: '1px solid rgba(255,255,255,0.15)',
      backgroundColor: 'rgba(255,255,255,0.08)',
      color: '#e2e8f0',
      boxShadow: '0 8px 20px -18px rgba(15,23,42,0.9)',
      transform: 'translateX(0)',
    }
    if (isHovered && !isActive) {
      return {
        ...base,
        backgroundColor: 'rgba(255,255,255,0.14)',
        border: '1px solid rgba(255,255,255,0.25)',
        transform: 'translateX(4px)',
      }
    }
    if (isActive) {
      return {
        ...base,
        background: 'linear-gradient(120deg, rgba(59,130,246,0.7), rgba(14,165,233,0.65))',
        border: '1px solid rgba(125,211,252,0.8)',
        boxShadow: '0 18px 35px -20px rgba(6,182,212,0.9)',
        transform: 'translateX(6px)',
      }
    }
    return base
  }

  // 导航图标外层容器样式，提供玻璃拟态高光
  const getNavIconStyle = (isActive: boolean) => ({
    background: isActive
      ? 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.65), rgba(255,255,255,0.15))'
      : 'rgba(255,255,255,0.12)',
    boxShadow: isActive
      ? 'inset 0 0 0 1px rgba(255,255,255,0.4)'
      : 'inset 0 0 0 1px rgba(255,255,255,0.2)',
    borderRadius: '12px',
    width: '40px',
    height: '40px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.25s ease',
  })


  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }
    setUser(getCurrentUser())
    setIsReady(true)
  }, [router])

  const handleLogout = () => {
    removeToken()
    router.replace('/login')
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">加载中...</div>
      </div>
    )
  }

  const navItems = [
    {
      label: '仪表盘',
      icon: <LayoutDashboard className="h-5 w-5" />,
      href: '/dashboard',
      hint: '全局概览'
    },
    {
      label: '我的笔记',
      icon: <FileText className="h-5 w-5" />,
      href: '/dashboard/notes',
      hint: '全部记录'
    },
    {
      label: '分类管理',
      icon: <Bookmark className="h-5 w-5" />,
      href: '/dashboard/categories',
      hint: '整理结构'
    },
    {
      label: '标签管理',
      icon: <Bookmark className="h-5 w-5" />,
      href: '/dashboard/tags',
      hint: '简单管理'
    },
    {
      label: '设置',
      icon: <Settings className="h-5 w-5" />,
      href: '/dashboard/settings',
      hint: '系统偏好'
    },
  ]

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* 桌面端侧边栏 */}
      {/* 桌面端侧边栏整体容器：使用深色渐变与玻璃质感 */}
      <aside
        className="relative hidden flex-col overflow-hidden md:flex"
        style={{
          width: '260px',
          borderTopRightRadius: '28px',
          borderBottomRightRadius: '32px',
          margin: '14px',
          marginRight: '0',
          background:
            'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,64,175,0.92) 55%, rgba(14,165,233,0.9) 120%)',
          boxShadow: '12px 20px 45px rgba(15, 23, 42, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* 顶部品牌区背景高光 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at top left, rgba(59,130,246,0.45), transparent 45%)',
            opacity: 0.8,
          }}
        />
        <div className="relative flex h-20 items-center gap-3 px-6 border-b border-white/10">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.9), rgba(147,51,234,0.8))',
              boxShadow: '0 15px 30px rgba(37, 99, 235, 0.45)',
            }}
          >
            <span className="text-2xl font-black text-white">N</span>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">笔记平台</p>
            <p className="text-xs uppercase tracking-[0.4em] text-white/70">Workspace</p>
          </div>
        </div>
        {/* 导航按钮列表 */}
        <nav className="relative flex-1 overflow-auto px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href))
            const isHovered = hoveredNav === item.href
            return (
              <Button
                key={item.href}
                variant="ghost"
                className="w-full justify-start text-white/85 backdrop-blur-sm"
                style={getNavButtonStyle(isActive, isHovered)}
                onMouseEnter={() => setHoveredNav(item.href)}
                onMouseLeave={() => setHoveredNav(null)}
                onClick={() => router.push(item.href)}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-9 w-1 rounded-full"
                    style={{
                      background: isActive
                        ? 'linear-gradient(to bottom, #5eead4, #2563eb)'
                        : 'rgba(255,255,255,0.2)',
                      transition: 'all 0.2s ease',
                    }}
                  />
                  <span className="mr-2" style={getNavIconStyle(isActive)}>
                    {item.icon}
                  </span>
                  <div className="flex flex-col text-left leading-tight">
                    <span>{item.label}</span>
                    <span className="text-[11px] text-white/70">{item.hint}</span>
                  </div>
                </div>
              </Button>
            )
          })}
        </nav>
        {/* 退出登录按钮区域 */}
        <div className="relative p-4 border-t border-white/10">
          <Button
            variant="ghost"
            className="w-full justify-start text-white/80 backdrop-blur-sm"
            style={{
              borderRadius: '16px',
              border: '1px solid rgba(239,68,68,0.4)',
              backgroundColor: 'rgba(239,68,68,0.12)',
              color: '#fecaca',
            }}
            onClick={handleLogout}
          >
            <LogOut className="mr-3 h-5 w-5" />
            退出登录
          </Button>
        </div>
      </aside>

      {/* 移动端菜单 */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div
            className="fixed left-0 top-0 h-full w-64 bg-white/95 backdrop-blur-md shadow-xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4 bg-gradient-to-r from-primary-600 to-primary-700">
              <h1 className="text-xl font-bold text-white">笔记平台</h1>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 transition-colors duration-200"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
            <nav className="flex-1 overflow-auto p-4 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href))
                return (
                  <Button
                    key={item.href}
                    variant="ghost"
                    className={`w-full justify-start transition-all duration-200 ${isActive
                        ? 'bg-primary-50 text-primary-700 hover:bg-primary-100 font-medium shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    onClick={() => {
                      router.push(item.href)
                      setIsMobileMenuOpen(false)
                    }}
                  >
                    <span className={`mr-3 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                      {item.icon}
                    </span>
                    <div className="flex flex-col text-left leading-tight">
                      <span>{item.label}</span>
                      <span className="text-[11px] text-gray-500">{item.hint}</span>
                    </div>
                  </Button>
                )
              })}
            </nav>
            <div className="p-4 border-t border-gray-200">
              <Button
                variant="ghost"
                className="w-full justify-start text-gray-600 hover:text-red-600 hover:bg-red-50 transition-colors duration-200"
                onClick={handleLogout}
              >
                <LogOut className="mr-3 h-5 w-5" />
                退出登录
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      {/* 主内容区采用浅色渐变背景 */}
      <main className="flex-1 overflow-auto bg-[#f7f9fc]">
        {/* 顶部吸附导航条，添加柔和渐变和模糊效果 */}
        <div
          className="sticky top-0 z-10 px-4 pt-4 pb-3 md:px-6 md:pt-6 md:pb-4"
          style={{
            background: 'linear-gradient(120deg, rgba(248,250,252,0.95), rgba(219,234,254,0.92))',
            boxShadow: '0 15px 30px -24px rgba(30,64,175,0.5)',
            borderBottom: '1px solid rgba(148,163,184,0.2)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* 顶部卡片容器：承载菜单按钮与用户信息 */}
          <header className="flex h-16 items-center justify-between rounded-2xl px-4 gap-4"
            style={{
              background: 'linear-gradient(120deg, rgba(255,255,255,0.95), rgba(255,255,255,0.75))',
              border: '1px solid rgba(226,232,240,0.7)',
              boxShadow: '0 15px 45px -30px rgba(15,23,42,0.45)',
            }}
          >
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                style={{
                  borderRadius: '14px',
                  border: '1px solid rgba(148,163,184,0.4)',
                  backgroundColor: 'rgba(226,232,240,0.45)',
                  color: '#0f172a',
                }}
                onClick={() => setIsMobileMenuOpen(true)}
              >
                <Menu className="h-6 w-6" />
              </Button>
              <div className="hidden md:flex flex-col">
                <span className="text-xs uppercase tracking-[0.3em] text-gray-400">Workspace</span>
                <span className="text-base font-semibold text-gray-900">每日知识面板</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(148,163,184,0.5)',
                  backgroundColor: 'rgba(226,232,240,0.6)',
                  color: '#0f172a',
                }}
              >
                <Bell className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(148,163,184,0.5)',
                  backgroundColor: 'rgba(226,232,240,0.6)',
                  color: '#0f172a',
                }}
              >
                <Settings2 className="h-5 w-5" />
              </Button>
              <div
                className="flex items-center gap-3 rounded-2xl px-3 py-2"
                style={{
                  border: '1px solid rgba(148,163,184,0.4)',
                  backgroundColor: 'rgba(241,245,249,0.8)',
                }}
              >
                <div
                  className="h-10 w-10 rounded-2xl flex items-center justify-center font-semibold"
                  style={{
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.9), rgba(147,51,234,0.85))',
                    color: '#fff',
                  }}
                >
                  {(user?.email || 'U')[0]?.toUpperCase()}
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">
                    {user?.email || '用户'}
                  </p>
                  <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    在线
                  </p>
                </div>
              </div>
              <div className="hidden md:block">
                <NetworkStatus onReconnect={() => { /* 可广播同步事件 */ }} />
              </div>
            </div>
          </header>
        </div>
        {/* 主内容背景区域，叠加径向渐变以提升层次 */}
        <div
          className="p-4 md:p-6 lg:p-8"
          style={{
            minHeight: 'calc(100vh - 140px)',
            background:
              'radial-gradient(circle at 20% 20%, rgba(59,130,246,0.08), transparent 35%), radial-gradient(circle at 80% 0%, rgba(14,165,233,0.08), transparent 40%)',
          }}
        >
          {/* 内容白色卡片容器，提供统一内边距与阴影 */}
          <div
            className="mx-auto w-full max-w-8xl animate-fade-in"
            style={{
              borderRadius: '28px',
              padding: '24px',
              backgroundColor: '#ffffff',
              border: '1px solid rgba(226,232,240,0.7)',
              boxShadow: '0 40px 80px -45px rgba(15,23,42,0.5)',
            }}
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
