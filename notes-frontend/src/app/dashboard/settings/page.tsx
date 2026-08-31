'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, AlertTriangle, LogOut, PanelLeft, Save, Trash2, UserRound } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { useEditorLayoutPreferences } from '@/components/editor/useEditorLayoutPreferences'
import { AiPerformancePanel } from '@/components/settings/AiPerformancePanel'
import { usersAPI } from '@/lib/api/users'
import { appToast } from '@/lib/app-toast'
import { getCurrentUser, logout, setCurrentUser } from '@/lib/auth'
import type { User } from '@/types'

const settingsGroupIds = new Set(['account', 'editor', 'ai-performance', 'danger'])

function PanelHeader({ icon, title, description, danger = false }: {
  icon: React.ReactNode
  title: string
  description: string
  danger?: boolean
}) {
  return (
    <header className="flex items-center gap-3 border-b border-[var(--product-line)] px-5 py-4">
      <span className={danger ? 'text-[var(--product-danger)]' : 'text-[var(--product-muted)]'} aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2 className={`text-[15px] font-semibold ${danger ? 'text-[var(--product-danger)]' : 'text-[var(--product-text)]'}`}>
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--product-muted)]">{description}</p>
      </div>
    </header>
  )
}

function FieldRow({ title, description, children }: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--product-text)]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--product-muted)]">{description}</p>
      </div>
      <div className="w-full shrink-0 sm:w-[330px]">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { autoSaveLayout, setAutoSaveLayout } = useEditorLayoutPreferences()
  const [user, setUser] = useState<User | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeGroup, setActiveGroup] = useState('account')
  const [aiPerformanceEnabled, setAiPerformanceEnabled] = useState(false)

  useEffect(() => {
    const currentUser = getCurrentUser()
    if (!currentUser) {
      router.replace('/login')
      return
    }
    setUser(currentUser)
    setDisplayName(currentUser.displayName ?? '')
    setLoading(false)
  }, [router])

  useEffect(() => {
    const syncGroupFromHash = () => {
      const group = window.location.hash.slice(1)
      const nextGroup = settingsGroupIds.has(group) ? group : 'account'
      setActiveGroup(nextGroup)
      if (nextGroup === 'ai-performance') setAiPerformanceEnabled(true)
    }
    syncGroupFromHash()
    window.addEventListener('hashchange', syncGroupFromHash)
    return () => window.removeEventListener('hashchange', syncGroupFromHash)
  }, [])

  const trimmedDisplayName = displayName.trim()
  const canSave = Boolean(trimmedDisplayName) && trimmedDisplayName !== (user?.displayName ?? '') && !saving

  const handleSaveProfile = async () => {
    if (!user || !canSave) return
    setSaving(true)
    try {
      const updatedUser = await usersAPI.updateProfile({ displayName: trimmedDisplayName })
      setUser(updatedUser)
      setDisplayName(updatedUser.displayName ?? '')
      setCurrentUser(updatedUser)
      toast.success('显示名称已更新')
    } catch (error) {
      appToast.error({
        id: 'settings:profile',
        title: '显示名称保存失败',
        message: error instanceof Error ? error.message : '请稍后重试',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    if (window.confirm('确定要退出登录吗？')) {
      void logout().then(() => router.replace('/login'))
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-label="正在加载设置">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--product-line-strong)] border-t-[var(--product-accent)]" />
      </div>
    )
  }

  return (
    <div>
      <header className="product-page-header mb-7">
        <h1 className="page-heading">设置</h1>
        <p className="page-description">管理账户资料与笔记编辑体验。</p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[180px_minmax(0,720px)] lg:gap-10">
        <nav className="flex flex-wrap gap-1 border-b border-[var(--product-line)] pb-3 lg:sticky lg:top-20 lg:self-start lg:flex-col lg:border-0 lg:pb-0" aria-label="设置分组">
          {[
            ['account', '账户信息'],
            ['editor', '编辑偏好'],
            ['ai-performance', 'AI 性能'],
            ['danger', '危险操作'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={activeGroup === id ? 'location' : undefined}
              onClick={() => {
                setActiveGroup(id)
                if (id === 'ai-performance') setAiPerformanceEnabled(true)
              }}
              className={`rounded-lg px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)] ${activeGroup === id ? 'bg-[var(--product-accent-soft)] font-semibold text-[var(--product-accent)]' : 'text-[var(--product-text-secondary)] hover:bg-[var(--product-surface-hover)] hover:text-[var(--product-text)]'}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <section id="account" className="calm-panel scroll-mt-24" aria-label="账户信息">
            <PanelHeader icon={<UserRound className="h-[18px] w-[18px]" />} title="账户信息" description="显示名称会用于侧栏和协作场景" />
            <div className="divide-y divide-[var(--product-line)]">
              <FieldRow title="显示名称" description="1–32 个字符，保存后立即同步到当前登录态">
                <div className="flex gap-2">
                  <input
                    id="display-name"
                    aria-label="显示名称"
                    value={displayName}
                    maxLength={32}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleSaveProfile()
                    }}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--product-line-strong)] bg-[var(--product-panel)] px-3 text-sm text-[var(--product-text)] outline-none transition focus:border-[var(--product-accent)] focus:ring-2 focus:ring-[var(--product-accent-soft)]"
                  />
                  <Button size="sm" onClick={() => void handleSaveProfile()} disabled={!canSave} aria-label="保存显示名称">
                    <Save className="h-4 w-4" />
                    {saving ? '保存中' : '保存'}
                  </Button>
                </div>
              </FieldRow>
              <FieldRow title="邮箱地址" description="用于登录，由后端唯一标识，无法修改">
                <input aria-label="邮箱地址" value={user?.email ?? ''} disabled className="h-10 w-full rounded-lg border border-[var(--product-line)] bg-[var(--product-surface-muted)] px-3 text-sm text-[var(--product-muted)]" />
              </FieldRow>
              <FieldRow title="账户创建时间" description="账户首次注册的日期，只读">
                <input aria-label="账户创建时间" value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : ''} disabled className="h-10 w-full rounded-lg border border-[var(--product-line)] bg-[var(--product-surface-muted)] px-3 text-sm text-[var(--product-muted)]" />
              </FieldRow>
            </div>
          </section>

          <section id="editor" className="calm-panel scroll-mt-24" aria-label="编辑偏好">
            <PanelHeader icon={<PanelLeft className="h-[18px] w-[18px]" />} title="编辑偏好" description="控制编辑器布局是否在下次打开时恢复" />
            <FieldRow title="自动保存布局" description="保存左栏宽度与折叠状态；关闭后每次打开编辑器都使用默认布局">
              <div className="flex justify-start sm:justify-end">
                <button
                  type="button"
                  role="switch"
                  aria-label="自动保存编辑器布局"
                  aria-checked={autoSaveLayout}
                  onClick={() => setAutoSaveLayout(!autoSaveLayout)}
                  className={`relative h-7 w-12 rounded-full transition-colors ${autoSaveLayout ? 'bg-[var(--product-accent)]' : 'bg-[var(--product-line-strong)]'}`}
                >
                  <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${autoSaveLayout ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </FieldRow>
          </section>

          <section id="ai-performance" className="calm-panel scroll-mt-24" aria-label="AI 性能">
            <PanelHeader icon={<Activity className="h-[18px] w-[18px]" />} title="AI 性能" description="查看当前账户的 AI 请求质量、耗时与阶段分布" />
            {aiPerformanceEnabled ? <AiPerformancePanel /> : <p className="px-5 py-6 text-sm text-[var(--product-muted)]">进入此分组后加载性能数据。</p>}
          </section>

          <section id="danger" className="calm-panel scroll-mt-24 border-[color-mix(in_srgb,var(--product-danger)_30%,var(--product-line))]" aria-label="危险操作">
            <PanelHeader icon={<AlertTriangle className="h-[18px] w-[18px]" />} title="危险操作" description="这些操作可能会影响您的账户安全" danger />
            <div className="divide-y divide-[var(--product-line)]">
              <FieldRow title="退出登录" description="清除当前登录态，之后需要重新登录">
                <div className="flex justify-start sm:justify-end">
                  <Button variant="outline" onClick={handleLogout} className="text-[var(--product-danger)]">
                    <LogOut className="h-4 w-4" />退出登录
                  </Button>
                </div>
              </FieldRow>
              <FieldRow title="删除账户" description="后端尚未提供删除账户接口，此功能暂未开放">
                <div className="flex items-center justify-start gap-3 sm:justify-end">
                  <span className="text-xs text-[var(--product-muted)]">暂未开放</span>
                  <Button variant="outline" disabled className="text-[var(--product-danger)]">
                    <Trash2 className="h-4 w-4" />删除账户
                  </Button>
                </div>
              </FieldRow>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
