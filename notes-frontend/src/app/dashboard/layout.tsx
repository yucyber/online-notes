'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, FileText, Bookmark, Settings, LogOut, Menu, X, Bell, Settings2, Clock, Search, Sun, Moon, ChevronRight } from 'lucide-react'
import NetworkStatus from '@/components/security/NetworkStatus'
import { getCurrentUser, isAuthenticated, removeToken } from '@/lib/auth'
import { globalHotkeys } from '@/lib/hotkeys'
import type { User } from '@/types'
import { listNotifications } from '@/lib/api'
import AIPet from '@/components/ai/AIPet'

const routeNames: Record<string, string> = {
  dashboard: '工作台',
  notes: '我的笔记',
  boards: '看板',
  mindmaps: '思维导图',
  tags: '标签管理',
  settings: '设置',
  trash: '回收站',
  new: '新建',
  edit: '编辑',
  categories: '分类管理',
  logs: '活动日志',
  profile: '个人资料',
  security: '安全设置',
  notifications: '通知',
  search: '搜索',
  invitations: '邀请',
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSidebarHidden, setIsSidebarHidden] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isDark, setIsDark] = useState<boolean>(typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false)
  // 详情/编辑/新建路由判定：在这些路由隐藏左侧导航
  // 匹配：/dashboard/notes/new、/dashboard/notes/[id]、/dashboard/notes/[id]/edit
  const isNotesFocusedRoute = Boolean(
    pathname && /^\/dashboard\/notes\/(new|[^/]+(?:\/edit)?)/.test(pathname)
  )
  // 简化导航样式：白底、轻边框、激活态使用品牌色
  const getNavButtonStyle = (isActive: boolean, isHovered: boolean) => {
    const base: React.CSSProperties = {
      borderRadius: '10px',
      padding: '10px 12px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--surface-1)',
      color: 'var(--on-surface)',
      boxShadow: 'none',
      transform: 'none',
    }
    if (isHovered && !isActive) {
      return {
        ...base,
        backgroundColor: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }
    }
    if (isActive) {
      return {
        ...base,
        backgroundColor: 'var(--primary-50)',
        border: '1px solid var(--primary-100)',
        color: 'var(--primary-600)',
      }
    }
    return base
  }

  const getNavIconStyle = (isActive: boolean) => ({
    backgroundColor: isActive ? 'var(--surface-2)' : 'var(--surface-3)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    width: '32px',
    height: '32px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s ease',
  })


  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }
    setUser(getCurrentUser())
    setIsReady(true)
    const detach = globalHotkeys.attach()
    globalHotkeys.register('Ctrl+K', () => {
      const input = document.getElementById('global-search') as HTMLInputElement | null
      input?.focus()
    })
    globalHotkeys.register('Ctrl+N', () => {
      router.push('/dashboard/notes/new')
    })
    globalHotkeys.register('Ctrl+P', () => {
      const el = document.getElementById('preview-toggle') as HTMLButtonElement | null;
      el?.click()
    })
    globalHotkeys.register('Ctrl+S', () => {
      const el = document.getElementById('save-button') as HTMLButtonElement | null;
      el?.click()
    })
    globalHotkeys.register('Ctrl+Shift+F', () => {
      try {
        const ev = new CustomEvent('editor:toggleFullscreen')
        document.dispatchEvent(ev)
      } catch { }
    })
    return () => { detach() }
  }, [router])

  useEffect(() => {
    try {
      const v = localStorage.getItem('sidebarHidden')
      setIsSidebarHidden(v === 'true')
    } catch { }
  }, [])

  // 未读铃铛角标：初始化与事件驱动刷新
  useEffect(() => {
    const loadUnread = async () => {
      try {
        const r = await listNotifications(1, 1, undefined, 'unread')
        setUnreadCount(Math.max(0, Number(r?.total || 0)))
      } catch { setUnreadCount(0) }
    }
    loadUnread()
    const handler = () => loadUnread()
    // 来自 API 层的刷新事件
    document.addEventListener('notify:refresh', handler as any)
    // 标签页激活时刷新，避免误差
    const vis = () => { if (document.visibilityState === 'visible') loadUnread() }
    document.addEventListener('visibilitychange', vis)
    return () => {
      document.removeEventListener('notify:refresh', handler as any)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  const handleLogout = () => {
    removeToken()
    router.replace('/login')
  }

  const toggleTheme = () => {
    const el = document.documentElement
    const next = !el.classList.contains('dark')
    if (next) {
      el.classList.add('dark')
      el.setAttribute('data-theme', 'dark')
      localStorage.setItem('theme', 'dark')
    } else {
      el.classList.remove('dark')
      el.setAttribute('data-theme', 'editor-light')
      localStorage.setItem('theme', 'light')
    }
    setIsDark(next)
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
      label: '活动日志',
      icon: <Clock className="h-5 w-5" />,
      href: '/dashboard/activity',
      hint: '变更记录'
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
    <div className="flex min-h-screen bg-[var(--surface-2)]">
      {/* 桌面端侧边栏 */}
      {/* 桌面端侧边栏整体容器：使用深色渐变与玻璃质感 */}
      {!isSidebarHidden && (
        <aside
          className="relative hidden flex-col overflow-hidden md:flex bg-[var(--surface-1)]"
          style={{
            width: '240px',
            margin: '0',
            borderRight: '1px solid var(--border)',
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
          <div className="relative flex h-16 items-center gap-3 px-4 border-b border-gray-200">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: '#10b981',
                color: '#fff',
              }}
            >
              <span className="text-2xl font-black text-white">N</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">笔记平台</p>
              <p className="text-xs text-gray-500">Workspace</p>
            </div>
          </div>
          {/* 导航按钮列表 */}
          <nav className="relative flex-1 overflow-auto px-3 py-4 space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href))
              const isHovered = hoveredNav === item.href
              return (
                <Button
                  key={item.href}
                  variant="ghost"
                  className="w-full justify-start"
                  style={getNavButtonStyle(isActive, isHovered)}
                  onMouseEnter={() => setHoveredNav(item.href)}
                  onMouseLeave={() => setHoveredNav(null)}
                  onClick={() => router.push(item.href)}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-6 w-1 rounded-full"
                      style={{
                        backgroundColor: isActive ? 'var(--primary-600)' : '#e5e7eb',
                        transition: 'background-color 0.2s ease',
                      }}
                    />
                    <span className="mr-2" style={getNavIconStyle(isActive)}>
                      {item.icon}
                    </span>
                    <div className="flex flex-col text-left leading-tight">
                      <span>{item.label}</span>
                      <span className="text-[11px] text-gray-500">{item.hint}</span>
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
      )}

      {/* 移动端菜单 */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 backdrop-blur-sm md:hidden animate-fade-in"
          style={{ backgroundColor: 'var(--overlay)' }}
          role="button"
          tabIndex={0}
          onClick={() => setIsMobileMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setIsMobileMenuOpen(false)
          }}
        >
          <div
            className="fixed left-0 top-0 h-full w-64 bg-[var(--surface-1)] shadow-xl animate-slide-up"
            role="dialog"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
              <h1 className="text-base font-semibold text-gray-900">笔记平台</h1>
              <Button
                variant="ghost"
                size="icon"
                className="text-[var(--on-surface)] hover:bg-[var(--surface-2)] transition-colors duration-200"
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
                      ? 'bg-[var(--primary-50)] text-[var(--primary-700)] hover:bg-[var(--primary-100)] font-medium shadow-sm'
                      : 'text-[var(--on-surface)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-2)]'
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
      {/* 主内容区采用浅色渐变背景，并在深色模式下增强对比 */}
      <main className="flex-1 overflow-auto bg-[var(--surface-2)]">
        {/* 顶部吸附导航条，添加柔和渐变和模糊效果 */}
        <div className="sticky top-0 z-10 px-4 pt-3 pb-3 md:px-6 md:pt-3 md:pb-3 bg-[var(--surface-1)] border-b" style={{ borderColor: 'var(--border)' }}>
          {/* 顶部卡片容器：承载菜单按钮与用户信息 */}
          <header className="flex h-12 items-center justify-between px-0 gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[var(--on-surface)] hover:bg-[var(--surface-2)]"
                onClick={() => {
                  try {
                    const isDesktop = window.innerWidth >= 768
                    if (isDesktop) {
                      setIsSidebarHidden((prev) => {
                        const next = !prev
                        try { localStorage.setItem('sidebarHidden', String(next)) } catch { }
                        return next
                      })
                    } else {
                      setIsMobileMenuOpen(true)
                    }
                  } catch { setIsMobileMenuOpen(true) }
                }}
                aria-label={isSidebarHidden ? '显示侧边栏' : '隐藏侧边栏'}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div className="hidden md:flex items-center gap-2">
                <div className="h-5 w-5 rounded-md bg-primary-600/90 flex items-center justify-center text-white text-xs font-bold">N</div>
                <span className="text-sm font-semibold text-text-secondary">笔记平台</span>
              </div>

              {/* 分隔线 */}
              <div className="hidden md:block h-4 w-[1px] bg-border/60 mx-1" />

              {/* 面包屑导航 - 紧凑美化版 */}
              <nav aria-label="Breadcrumb" className="hidden md:flex items-center">
                {pathname?.split('/').filter(Boolean).map((segment, index, array) => {
                  const isLast = index === array.length - 1
                  const path = `/${array.slice(0, index + 1).join('/')}`
                  const name = routeNames[segment] || (segment.length > 20 ? `${segment.slice(0, 8)}...` : segment)

                  return (
                    <div key={path} className="flex items-center">
                      {index > 0 && <ChevronRight className="mx-1 h-3 w-3 text-text-muted/60" />}
                      {isLast ? (
                        <span className="px-1.5 py-0.5 text-xs font-medium text-text-primary bg-surface-2/50 rounded-md animate-in fade-in zoom-in-95 duration-200">
                          {name}
                        </span>
                      ) : (
                        <button
                          onClick={() => router.push(path)}
                          className="px-1.5 py-0.5 text-xs text-text-secondary hover:text-primary-600 hover:bg-surface-2 rounded-md transition-all duration-200"
                        >
                          {name}
                        </button>
                      )}
                    </div>
                  )
                })}
              </nav>
            </div>

            <div className="flex items-center gap-2">
              {/* 主题切换 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-[var(--surface-2)]"
                aria-label={isDark ? '切换到浅色主题' : '切换到深色主题'}
                aria-pressed={isDark}
                onClick={toggleTheme}
                title={isDark ? '浅色主题' : '深色主题'}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <span className="hidden md:inline text-[10px]" aria-live="polite" style={{ color: 'var(--text-muted)' }}>{isDark ? '深色' : '浅色'}</span>

              {/* 消息铃铛 */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[var(--on-surface)] hover:bg-[var(--surface-2)]"
                  onClick={() => router.push('/dashboard/notifications')}
                  aria-label={unreadCount > 0 ? `消息中心，未读 ${unreadCount} 条` : '打开消息中心'}
                  aria-describedby="notify-unread-status"
                >
                  <Bell className="h-4 w-4" />
                </Button>
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 min-w-[6px] h-[6px] rounded-full bg-red-600 ring-2 ring-surface-1"
                  />
                )}
                <div id="notify-unread-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                  未读 {unreadCount} 条
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[var(--on-surface)] hover:bg-[var(--surface-2)]"
                onClick={() => router.push('/dashboard/settings')}
                aria-label="打开设置"
              >
                <Settings2 className="h-4 w-4" />
              </Button>

              {/* 用户信息 - 紧凑版 */}
              <div
                className="flex items-center gap-2 rounded-lg px-2 py-1 border border-border/40 bg-surface-1 hover:bg-surface-2 transition-colors cursor-default"
              >
                <div
                  className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold text-white shadow-sm"
                  style={{ backgroundColor: '#2468F2' }}
                >
                  {String(user?.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-medium text-text-default leading-tight">
                    {user?.email?.split('@')[0] || '用户'}
                  </p>
                  <p className="text-[10px] text-text-muted flex items-center gap-1 justify-end leading-tight">
                    <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    在线
                  </p>
                </div>
              </div>
              <div className="hidden md:block scale-90 origin-right">
                <NetworkStatus onReconnect={() => { /* 可广播同步事件 */ }} />
              </div>
            </div>
          </header>
        </div>
        <div className="p-4 md:p-6 lg:p-8">
          <div className={`mx-auto w-full ${isNotesFocusedRoute ? '' : 'max-w-7xl'} animate-fade-in rounded-xl p-4 md:p-6 bg-[var(--surface-1)] border shadow-sm`} style={{ borderColor: 'var(--border)' }}>
            {children}
          </div>
        </div>
      </main>
      <AIPet />
    </div>
  )
}
