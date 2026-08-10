'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import AIPet from '@/components/ai/AIPet'
import { DashboardHeader, DashboardSidebar } from '@/components/dashboard/dashboard-navigation'
import { getCurrentUser, isAuthenticated, logout } from '@/lib/auth'
import { globalHotkeys } from '@/lib/hotkeys'
import { listNotifications } from '@/lib/api'
import type { User } from '@/types'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSidebarHidden, setIsSidebarHidden] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isDark, setIsDark] = useState(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))

  const isNotesFocusedRoute = Boolean(pathname && /^\/dashboard\/notes\/(new|[^/]+(?:\/edit)?)/.test(pathname))

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }
    setUser(getCurrentUser())
    setIsReady(true)
    const detach = globalHotkeys.attach()
    globalHotkeys.register('Ctrl+K', () => document.getElementById('global-search')?.focus())
    globalHotkeys.register('Ctrl+N', () => router.push('/dashboard/notes/new'))
    globalHotkeys.register('Ctrl+P', () => (document.getElementById('preview-toggle') as HTMLButtonElement | null)?.click())
    globalHotkeys.register('Ctrl+S', () => (document.getElementById('save-button') as HTMLButtonElement | null)?.click())
    globalHotkeys.register('Ctrl+Shift+F', () => document.dispatchEvent(new CustomEvent('editor:toggleFullscreen')))
    return () => detach()
  }, [router])

  useEffect(() => {
    try { setIsSidebarHidden(localStorage.getItem('sidebarHidden') === 'true') } catch { /* storage is optional */ }
  }, [])

  useEffect(() => {
    const loadUnread = async () => {
      try {
        const response = await listNotifications(1, 1, undefined, 'unread')
        setUnreadCount(Math.max(0, Number(response?.total || 0)))
      } catch { setUnreadCount(0) }
    }
    void loadUnread()
    const handleRefresh = () => void loadUnread()
    const handleVisibility = () => { if (document.visibilityState === 'visible') void loadUnread() }
    document.addEventListener('notify:refresh', handleRefresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('notify:refresh', handleRefresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const handleLogout = () => { void logout().then(() => router.replace('/login')) }
  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'editor-light')
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setIsDark(next)
  }
  const toggleSidebar = () => {
    try {
      if (window.innerWidth >= 768) {
        setIsSidebarHidden((current) => { const next = !current; localStorage.setItem('sidebarHidden', String(next)); return next })
      } else setIsMobileMenuOpen(true)
    } catch { setIsMobileMenuOpen(true) }
  }

  if (!isReady) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><div className="text-center text-gray-500">加载中...</div></div>

  return <div className="flex min-h-screen bg-[var(--surface-2)]">
    <DashboardSidebar pathname={pathname} isHidden={isSidebarHidden} isMobileOpen={isMobileMenuOpen} hoveredNav={hoveredNav} onHover={setHoveredNav} onNavigate={(href) => router.push(href)} onLogout={handleLogout} onCloseMobile={() => setIsMobileMenuOpen(false)} />
    <main className="flex-1 overflow-auto bg-[var(--surface-2)]">
      <DashboardHeader pathname={pathname} user={user} isDark={isDark} isSidebarHidden={isSidebarHidden} unreadCount={unreadCount} onToggleSidebar={toggleSidebar} onToggleTheme={toggleTheme} onNavigate={(href) => router.push(href)} />
      <div className="p-4 md:p-6 lg:p-8"><div className={`mx-auto w-full ${isNotesFocusedRoute ? '' : 'max-w-7xl'} animate-fade-in rounded-xl p-4 md:p-6 bg-[var(--surface-1)] border shadow-sm`} style={{ borderColor: 'var(--border)' }}>{children}</div></div>
    </main>
    <AIPet />
  </div>
}
