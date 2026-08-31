'use client'

import { useEffect, useState } from 'react'
import type { User } from '@/types'
import type { BreadcrumbOverride } from '@/hooks/useBreadcrumb'

export const routeNames: Record<string, string> = {
  dashboard: '工作台', notes: '我的笔记', 'knowledge-bases': '知识库', boards: '看板', mindmaps: '思维导图', tags: '标签管理', settings: '设置', new: '新建', edit: '编辑', categories: '分类管理', activity: '活动日志', notifications: '消息中心', versions: '版本记录',
}

type IconName = 'dashboard' | 'notes' | 'knowledge' | 'activity' | 'categories' | 'tags' | 'settings'
type NavigationItem = { label: string; icon: IconName; href: string }
export type { BreadcrumbOverride }

export const navGroups: Array<{ label: string; items: NavigationItem[] }> = [
  { label: '工作台', items: [
    { label: '仪表盘', icon: 'dashboard', href: '/dashboard' },
    { label: '我的笔记', icon: 'notes', href: '/dashboard/notes' },
    { label: '知识库', icon: 'knowledge', href: '/dashboard/knowledge-bases' },
    { label: '活动日志', icon: 'activity', href: '/dashboard/activity' },
  ] },
  { label: '管理', items: [
    { label: '分类管理', icon: 'categories', href: '/dashboard/categories' },
    { label: '标签管理', icon: 'tags', href: '/dashboard/tags' },
  ] },
]

const settingsItem: NavigationItem = { label: '设置', icon: 'settings', href: '/dashboard/settings' }
const isActiveRoute = (pathname: string | null, href: string) => Boolean(pathname === href || (href !== '/dashboard' && pathname?.startsWith(href)))
export const shouldUseOverlaySidebar = (viewportWidth: number) => viewportWidth < 1024

function PrototypeIcon({ name }: { name: IconName }) {
  return <svg aria-hidden="true">
    {name === 'dashboard' && <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>}
    {name === 'notes' && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>}
    {name === 'knowledge' && <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z"/><path d="M4 6.5v13"/></>}
    {name === 'activity' && <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
    {name === 'categories' && <><path d="M3 6h6l2 2h10v10H3z"/><path d="M8 12h8M8 15h5"/></>}
    {name === 'tags' && <><path d="M20 12 12 20 4 12V4h8z"/><circle cx="9" cy="9" r="1"/></>}
    {name === 'settings' && <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></>}
  </svg>
}

function NavItem({ item, pathname, onNavigate, onHover }: { item: NavigationItem; pathname: string | null; onNavigate: (href: string) => void; onHover: (href: string | null) => void }) {
  const active = isActiveRoute(pathname, item.href)
  return <button className={`dashboard-nav-item ${active ? 'dashboard-nav-item--active' : ''}`} aria-current={active ? 'page' : undefined} onMouseEnter={() => onHover(item.href)} onMouseLeave={() => onHover(null)} onClick={() => onNavigate(item.href)}><PrototypeIcon name={item.icon} /><span>{item.label}</span></button>
}

function SidebarContent({ pathname, onNavigate, onHover, onCloseMobile }: { pathname: string | null; onNavigate: (href: string) => void; onHover: (href: string | null) => void; onCloseMobile?: () => void }) {
  const navigate = (href: string) => { onNavigate(href); onCloseMobile?.() }
  return <><div className="dashboard-brand"><span>N</span><b>在线笔记</b></div><nav className="dashboard-nav-scroll" aria-label="工作台导航">{navGroups.map((group) => <section key={group.label} className="dashboard-nav-group"><h2>{group.label}</h2>{group.items.map((item) => <NavItem key={item.href} item={item} pathname={pathname} onNavigate={navigate} onHover={onHover} />)}</section>)}</nav><div className="dashboard-nav-bottom"><NavItem item={settingsItem} pathname={pathname} onNavigate={navigate} onHover={onHover} /></div></>
}

export function DashboardSidebar({ pathname, isHidden, isMobileOpen, hoveredNav: _hoveredNav, onHover, onNavigate, onLogout: _onLogout, onCloseMobile }: { pathname: string | null; isHidden: boolean; isMobileOpen: boolean; hoveredNav: string | null; onHover: (href: string | null) => void; onNavigate: (href: string) => void; onLogout: () => void; onCloseMobile: () => void }) {
  return <>{!isHidden && <aside className="dashboard-sidebar"><SidebarContent pathname={pathname} onNavigate={onNavigate} onHover={onHover} /></aside>}{isMobileOpen && <div className="dashboard-mobile-scrim" role="presentation" onMouseDown={onCloseMobile}><aside className="dashboard-mobile-sidebar" role="dialog" aria-modal="true" aria-label="工作台导航" onMouseDown={(event) => event.stopPropagation()}><button className="prototype-icon-button dashboard-mobile-close" onClick={onCloseMobile} aria-label="关闭导航"><svg><path d="m6 6 12 12M18 6 6 18"/></svg></button><SidebarContent pathname={pathname} onNavigate={onNavigate} onHover={onHover} onCloseMobile={onCloseMobile} /></aside></div>}</>
}

export function DashboardHeader({ pathname, user, isDark, isSidebarHidden, unreadCount, breadcrumbOverride, onToggleSidebar, onToggleTheme, onNavigate, onLogout }: { pathname: string | null; user: User | null; isDark: boolean; isSidebarHidden: boolean; unreadCount: number; breadcrumbOverride?: BreadcrumbOverride | null; onToggleSidebar: () => void; onToggleTheme: () => void; onNavigate: (href: string) => void; onLogout: () => void }) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const displayName = user?.displayName || user?.email?.split('@')[0] || '用户'
  return <header className="dashboard-topbar"><div className="dashboard-topbar-left"><button className="prototype-icon-button" onClick={onToggleSidebar} aria-label={isSidebarHidden ? '显示侧边栏' : '隐藏侧边栏'}><svg><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><Breadcrumb pathname={pathname} onNavigate={onNavigate} override={breadcrumbOverride} /></div><div className="dashboard-topbar-right"><button className="prototype-icon-button" aria-label={isDark ? '切换到浅色主题' : '切换到深色主题'} aria-pressed={isDark} onClick={onToggleTheme}><svg><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg></button><button className="prototype-icon-button dashboard-notification" onClick={() => onNavigate('/dashboard/notifications')} aria-label={unreadCount > 0 ? `消息中心，未读 ${unreadCount} 条` : '打开消息中心'}><svg><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></button><div className="relative"><button className="dashboard-avatar" aria-label="打开用户菜单" aria-expanded={isUserMenuOpen} onClick={() => setIsUserMenuOpen((open) => !open)}>{displayName.charAt(0).toUpperCase()}</button>{isUserMenuOpen && <div role="menu" tabIndex={-1} className="dashboard-user-menu"><div>{displayName}</div><button role="menuitem" onClick={() => { setIsUserMenuOpen(false); onNavigate('/dashboard/settings') }}>设置</button><button role="menuitem" onClick={onLogout}>退出登录</button></div>}</div></div></header>
}

export function Breadcrumb({ pathname, onNavigate, override }: { pathname: string | null; onNavigate: (href: string) => void; override?: BreadcrumbOverride | null }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const segments = pathname?.split('/').filter(Boolean) || []
  const fallbackItems = segments.map((segment, index) => ({
    label: routeNames[segment] || (segment.length > 20 ? `${segment.slice(0, 8)}...` : segment),
    href: index < segments.length - 1 ? `/${segments.slice(0, index + 1).join('/')}` : undefined,
  }))
  const items = override?.items || fallbackItems
  useEffect(() => { if (!editing) setDraft(items.at(-1)?.label || '') }, [editing, items])
  const commit = async () => {
    if (!override?.onRename) return setEditing(false)
    try {
      await override.onRename(draft)
      setEditing(false)
    } catch {
      setDraft(items.at(-1)?.label || '')
      setEditing(false)
    }
  }
  return <nav aria-label="面包屑" className="dashboard-crumbs">{items.map((item, index) => { const isLast = index === items.length - 1; return <span key={`${item.href || 'current'}:${index}`}>{index > 0 && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>}{isLast && override?.onRename ? (editing ? <input autoFocus aria-label="思维导图标题" value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commit() } else if (event.key === 'Escape') { setDraft(item.label); setEditing(false) } }} className="max-w-56 rounded border border-gray-300 px-2 py-1 text-sm font-semibold" /> : <button aria-label="编辑思维导图标题" title="点击重命名" onClick={() => { setDraft(item.label); setEditing(true) }}><b>{item.label}</b></button>) : item.href ? <button onClick={() => onNavigate(item.href!)}>{item.label}</button> : <b>{item.label}</b>}</span> })}</nav>
}
