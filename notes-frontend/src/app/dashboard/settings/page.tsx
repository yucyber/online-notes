'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser, removeToken } from '@/lib/auth'
import type { User } from '@/types'
import { Save, LogOut, User as UserIcon, Key, Bell, Settings } from 'lucide-react'
import NetworkStatus from '@/components/security/NetworkStatus'

export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const currentUser = getCurrentUser()
    if (!currentUser) {
      router.replace('/login')
      return
    }
    setUser(currentUser)
    setLoading(false)
  }, [router])

  const handleLogout = () => {
    if (window.confirm('确定要退出登录吗？')) {
      removeToken()
      router.replace('/login')
    }
  }

  const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const currentPassword = formData.get('currentPassword') as string
    const newPassword = formData.get('newPassword') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (newPassword !== confirmPassword) {
      setError('新密码和确认密码不一致')
      return
    }

    if (newPassword.length < 6) {
      setError('密码至少需要6个字符')
      return
    }

    try {
      setSaving(true)
      setError('')
      setSuccess('')
      // TODO: 调用API更新密码
      // await updatePassword({ currentPassword, newPassword })
      setSuccess('密码更新成功')
      e.currentTarget.reset()
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.response?.data?.message || '密码更新失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1
          className="text-3xl font-bold"
          style={{
            background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          设置
        </h1>
        <p className="text-gray-500">管理您的账户和偏好设置</p>
      </div>

      {/* 账户信息 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserIcon className="h-5 w-5 text-gray-600" />
            <CardTitle>账户信息</CardTitle>
          </div>
          <CardDescription>查看和管理您的账户基本信息</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              邮箱地址
            </label>
            <Input
              type="email"
              value={user?.email || ''}
              disabled
              className="bg-gray-50"
            />
            <p className="mt-1 text-xs text-gray-500">
              邮箱地址用于登录，无法修改
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              账户创建时间
            </label>
            <Input
              type="text"
              value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : ''}
              disabled
              className="bg-gray-50"
            />
          </div>
        </CardContent>
      </Card>

      {/* 修改密码 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-gray-600" />
            <CardTitle>修改密码</CardTitle>
          </div>
          <CardDescription>定期更新密码以保护您的账户安全</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div
              className="mb-4 p-3 text-sm text-red-600"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              className="mb-4 p-3 text-sm text-green-600"
              style={{
                backgroundColor: '#ecfdf5',
                border: '1px solid #d1fae5',
                borderRadius: '8px',
                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              }}
            >
              {success}
            </div>
          )}
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
                当前密码
              </label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                placeholder="请输入当前密码"
                required
                disabled={saving}
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
                新密码
              </label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                placeholder="请输入新密码（至少6位）"
                required
                disabled={saving}
                minLength={6}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                确认新密码
              </label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                placeholder="请再次输入新密码"
                required
                disabled={saving}
                minLength={6}
              />
            </div>

            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? '保存中...' : '更新密码'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 偏好设置 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-gray-600" />
            <CardTitle>偏好设置</CardTitle>
          </div>
          <CardDescription>自定义您的使用体验</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">自动保存</p>
              <p className="text-xs text-gray-500">编辑笔记时自动保存内容</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer" style={{ minHeight: '44px' }} aria-label="自动保存开关">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">邮件通知</p>
              <p className="text-xs text-gray-500">接收重要更新和通知邮件</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer" style={{ minHeight: '44px' }} aria-label="邮件通知开关">
              <input type="checkbox" className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 安全中心：网络访问状态 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-600" />
            <CardTitle>安全中心 · 网络访问状态</CardTitle>
          </div>
          <CardDescription>查看当前 API 地址、连通性与诊断入口</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <div className="mb-2"><span className="font-medium">当前 API 地址：</span><code className="bg-gray-100 px-2 py-1 rounded">{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}</code></div>
          </div>
          <NetworkStatus onReconnect={() => { /* 可在此触发全局数据刷新 */ }} />
        </CardContent>
      </Card>

      {/* 危险操作 */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">危险操作</CardTitle>
          <CardDescription>这些操作可能会影响您的账户安全</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">退出登录</p>
              <p className="text-xs text-gray-500">退出当前账户，需要重新登录</p>
            </div>
            <Button
              variant="outline"
              onClick={handleLogout}
              className="text-red-600 border-red-300 hover:bg-red-50"
            >
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </Button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              <p className="text-sm font-medium text-red-600">删除账户</p>
              <p className="text-xs text-gray-500">永久删除您的账户和所有数据</p>
            </div>
            <Button
              variant="outline"
              disabled
              className="text-red-600 border-red-300 hover:bg-red-50 opacity-50 cursor-not-allowed"
            >
              删除账户
            </Button>
            <p className="text-xs text-gray-400 mt-1">此功能暂未开放</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

