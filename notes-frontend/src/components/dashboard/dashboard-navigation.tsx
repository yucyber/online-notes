'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Bell, BookOpenCheck, ChevronDown, ChevronRight, Clock, FileText, FolderTree, LayoutDashboard, LogOut, Menu, Moon, Settings, Sun, Tags, Wifi, X } from 'lucide-react'
import type { User } from '@/types'

export const routeNames: Record<string, string> = {
  dashboard: '工作台', notes: '我的笔记', 'knowledge-bases': '知识库', boards: '看板', mindmaps: '思维导图', tags: '标签管理', settings: '设置', new: '新建', edit: '编辑', categories: '分类管理', activity: '活动日志', notifications: '通知',
}

export const navGroups = [
  { label: '主导航', items: [
    { label: '仪表盘', icon: LayoutDashboard, href: '/dashboard' },
    { label: '我的笔记', icon: FileText, href: '/dashboard/notes' },
    { label: '知识库', icon: BookOpenCheck, href: '/dashboard/knowledge-bases' },
    { label: '活动日志', icon: Clock, href: '/dashboard/activity' },
  ] },
  { label: '管理', items: [
    { label: '分类管理', icon: FolderTree, href: '/dashboard/categories' },
    { label: '标签管理', icon: Tags, href: '/dashboard/tags' },
  ] },
] as const

const settingsItem = { label: '设置', icon: Settings, href: '/dashboard/settings' }
const isActiveRoute = (pathname: string | null, href: string) => Boolean(pathname === href || (href !== '/dashboard' && pathname?.startsWith(href)))
export const shouldUseOverlaySidebar = (viewportWidth: number) => viewportWidth < 1024

type NavigationItem = { label: string; icon: React.ComponentType<{ className?: string }>; href: string }

function NavItem({ item, pathname, onNavigate, onHover }: { item: NavigationItem; pathname: string | null; onNavigate: (href: string) => void; onHover: (href: string | null) => void }) {
  const active = isActiveRoute(pathname, item.href)
  const Icon = item.icon
  return <Button variant="ghost" className={`dashboard-nav-item ${active ? 'dashboard-nav-item--active' : ''}`} aria-current={active ? 'page' : undefined} onMouseEnter={() => onHover(item.href)} onMouseLeave={() => onHover(null)} onClick={() => onNavigate(item.href)}><Icon className="h-[18px] w-[18px]" /><span>{item.label}</span></Button>
}

function SidebarContent({ pathname, onNavigate, onHover, onCloseMobile }: { pathname: string | null; onNavigate: (href: string) => void; onHover: (href: string | null) => void; onCloseMobile?: () => void }) {
  const navigate = (href: string) => { onNavigate(href); onCloseMobile?.() }
  return <>
    <div className="flex h-[64px] items-center gap-3 border-b border-[var(--product-line-soft)] px-4"><div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#263244] text-sm font-bold text-white">N</div><div><p className="text-sm font-semibold text-[var(--product-text)]">在线笔记</p><p className="text-[11px] text-[var(--product-muted)]">Workspace</p></div></div>
    <nav className="flex-1 overflow-auto px-3 py-4" aria-label="工作台导航">{navGroups.map((group) => <section key={group.label} className="mb-5" aria-labelledby={`nav-${group.label}`}><h2 id={`nav-${group.label}`} className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-[var(--product-muted)]">{group.label}</h2><div className="space-y-1">{group.items.map((item) => <NavItem key={item.href} item={item} pathname={pathname} onNavigate={navigate} onHover={onHover} />)}</div></section>)}</nav>
    <div className="border-t border-[var(--product-line-soft)] p-3"><NavItem item={settingsItem} pathname={pathname} onNavigate={navigate} onHover={onHover} /></div>
  </>
}

export function DashboardSidebar({ pathname, isHidden, isMobileOpen, hoveredNav: _hoveredNav, onHover, onNavigate, onLogout: _onLogout, onCloseMobile }: { pathname: string | null; isHidden: boolean; isMobileOpen: boolean; hoveredNav: string | null; onHover: (href: string | null) => void; onNavigate: (href: string) => void; onLogout: () => void; onCloseMobile: () => void }) {
  return <>
    {!isHidden && <aside className="hidden w-[236px] flex-col overflow-hidden border-r border-[var(--product-line)] bg-[var(--product-panel-soft)] lg:flex"><SidebarContent pathname={pathname} onNavigate={onNavigate} onHover={onHover} /></aside>}
    {isMobileOpen && <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" role="presentation" onMouseDown={onCloseMobile}><aside className="fixed left-0 top-0 flex h-full w-[min(280px,calc(100vw-48px))] flex-col bg-[var(--product-panel)]" role="dialog" aria-modal="true" aria-label="工作台导航" onMouseDown={(event) => event.stopPropagation()}><Button variant="ghost" size="icon" className="absolute right-2 top-2 z-10" onClick={onCloseMobile} aria-label="关闭导航"><X className="h-5 w-5" /></Button><SidebarContent pathname={pathname} onNavigate={onNavigate} onHover={onHover} onCloseMobile={onCloseMobile} /></aside></div>}
  </>
}

export function DashboardHeader({ pathname, user, isDark, isSidebarHidden, unreadCount, onToggleSidebar, onToggleTheme, onNavigate, onLogout }: { pathname: string | null; user: User | null; isDark: boolean; isSidebarHidden: boolean; unreadCount: number; onToggleSidebar: () => void; onToggleTheme: () => void; onNavigate: (href: string) => void; onLogout: () => void }) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const displayName = user?.email?.split('@')[0] || '用户'
  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-[var(--product-line)] bg-[var(--product-panel)] px-4 md:px-6">
    <div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label={isSidebarHidden ? '显示侧边栏' : '隐藏侧边栏'}><Menu className="h-4 w-4" /></Button><Breadcrumb pathname={pathname} onNavigate={onNavigate} /></div>
    <div className="flex items-center gap-1"><div className="hidden items-center gap-1.5 px-2 text-xs text-[var(--product-text-secondary)] sm:flex" title="服务在线"><Wifi className="h-4 w-4 text-emerald-600" /><span>在线</span></div><Button variant="ghost" size="icon" aria-label={isDark ? '切换到浅色主题' : '切换到深色主题'} aria-pressed={isDark} onClick={onToggleTheme}>{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button><div className="relative"><Button variant="ghost" size="icon" onClick={() => onNavigate('/dashboard/notifications')} aria-label={unreadCount > 0 ? `消息中心，未读 ${unreadCount} 条` : '打开消息中心'}><Bell className="h-4 w-4" /></Button>{unreadCount > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--product-danger)]" />}</div><div className="relative"><Button variant="ghost" className="h-11 gap-2 px-2" aria-haspopup="menu" aria-expanded={isUserMenuOpen} onClick={() => setIsUserMenuOpen((open) => !open)}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--product-accent)] text-xs font-semibold text-white">{displayName.charAt(0).toUpperCase()}</span><span className="hidden text-sm font-medium text-[var(--product-text)] sm:inline">{displayName}</span><ChevronDown className="hidden h-3.5 w-3.5 sm:block" /></Button>{isUserMenuOpen && <div role="menu" tabIndex={-1} className="absolute right-0 top-[calc(100%+8px)] w-48 rounded-[10px] border border-[var(--product-line)] bg-[var(--product-panel)] p-1.5 shadow-[var(--product-shadow)]"><div className="border-b border-[var(--product-line-soft)] px-2 py-2 text-xs text-[var(--product-text-secondary)]">{user?.email || displayName}</div><button role="menuitem" className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left text-sm text-[var(--product-text)] hover:bg-[var(--product-panel-soft)]" onClick={() => { setIsUserMenuOpen(false); onNavigate('/dashboard/settings') }}><Settings className="h-4 w-4" />设置</button><button role="menuitem" className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left text-sm text-[var(--product-danger)] hover:bg-[var(--product-danger-soft)]" onClick={onLogout}><LogOut className="h-4 w-4" />退出登录</button></div>}</div></div>
  </header>
}

function Breadcrumb({ pathname, onNavigate }: { pathname: string | null; onNavigate: (href: string) => void }) {
  return <nav aria-label="面包屑" className="hidden min-w-0 items-center md:flex">{pathname?.split('/').filter(Boolean).map((segment, index, array) => { const isLast = index === array.length - 1; const path = `/${array.slice(0, index + 1).join('/')}`; const name = routeNames[segment] || (segment.length > 20 ? `${segment.slice(0, 8)}...` : segment); return <div key={path} className="flex min-w-0 items-center">{index > 0 && <ChevronRight className="mx-1 h-3 w-3 shrink-0 text-[var(--product-muted)]" />}{isLast ? <span className="truncate px-1.5 text-sm font-medium text-[var(--product-text)]">{name}</span> : <button onClick={() => onNavigate(path)} className="truncate px-1.5 text-sm text-[var(--product-text-secondary)] hover:text-[var(--product-accent)]">{name}</button>}</div> })}</nav>
}
