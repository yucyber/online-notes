'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { login, register } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isValidEmail } from '@/utils'
import { persistAuthSession } from '@/lib/auth'

const loginSchema = z.object({
  email: z
    .string()
    .email('请输入有效的邮箱地址')
    .refine((email) => isValidEmail(email), '邮箱格式不正确'),
  password: z
    .string()
    .min(6, '密码至少6个字符')
    .max(50, '密码不能超过50个字符'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // 保证自动登录只执行一次
  const autoAttemptedRef = useRef(false)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const onSubmit = async (values: LoginFormValues) => {
    try {
      setIsLoading(true)
      setError('')
      const result = await login(values)
      persistAuthSession(result.token, result.user)
      router.push('/dashboard/notes')
      router.refresh()
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const msg = String(err?.response?.data?.message || '')
      const status = Number(err?.response?.status || 0)
      // 仅在自动模式下进行注册回退，避免误注册
      const isAuto = searchParams.get('auto') === '1'
      if (isAuto && (status === 401 || /invalid|not ?found|不存在/i.test(msg))) {
        try {
          const reg = await register({ email: values.email, password: values.password })
          persistAuthSession(reg.token, reg.user)
          router.push('/dashboard/notes')
          router.refresh()
          return
        } catch (e: any) {
          setError(e?.response?.data?.message || '登录失败，请检查邮箱和密码')
        }
      } else {
        setError(msg || '登录失败，请检查邮箱和密码')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // 开发便捷：支持通过查询参数自动登录（仅在客户端首次渲染后执行）
  // URL示例：/login?auto=1&email=user@example.com&password=password123
  useEffect(() => {
    if (autoAttemptedRef.current) return
    const auto = searchParams.get('auto')
    if (auto === '1') {
      const email = searchParams.get('email') || 'user@example.com'
      const password = searchParams.get('password') || 'password123'
      // 预填表单值，便于用户观察
      form.setValue('email', email)
      form.setValue('password', password)
      autoAttemptedRef.current = true
      // 异步提交，避免同步渲染冲突
      Promise.resolve().then(() => onSubmit({ email, password }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 via-white to-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <div 
            className="inline-flex items-center justify-center w-16 h-16 mb-4"
            style={{
              borderRadius: '50%',
              background: 'linear-gradient(to bottom right, #2563eb, #1d4ed8)',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
              WebkitBoxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
              MozBoxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
            }}
          >
            <span className="text-2xl font-bold text-white">笔记</span>
          </div>
          <h1 
            className="text-4xl font-bold mb-3"
            style={{
              background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            欢迎回来
          </h1>
          <p className="text-gray-600 text-lg">
            请登录您的账户以继续
          </p>
        </div>

        <div 
          className="bg-white border border-gray-200 p-8 backdrop-blur-sm"
          style={{
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            WebkitBoxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            MozBoxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          }}
        >
          {error && (
            <div 
              className="mb-6 p-4 text-sm text-red-600"
              style={{
                background: 'linear-gradient(to right, #fef2f2, #fee2e2)',
                border: '2px solid #fecaca',
                borderRadius: '12px',
                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                WebkitBoxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                MozBoxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-bold text-gray-700 mb-2">
                邮箱地址
              </label>
              <Input
                id="email"
                type="email"
                placeholder="请输入邮箱地址"
                disabled={isLoading}
                {...form.register('email')}
                autoComplete="email"
                className={`h-12 text-base ${form.formState.errors.email ? 'border-red-500 ring-2 ring-red-200' : ''}`}
              />
              {form.formState.errors.email && (
                <p className="mt-2 text-sm text-red-600 font-medium">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-bold text-gray-700 mb-2">
                密码
              </label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                disabled={isLoading}
                {...form.register('password')}
                autoComplete="current-password"
                className={`h-12 text-base ${form.formState.errors.password ? 'border-red-500 ring-2 ring-red-200' : ''}`}
              />
              {form.formState.errors.password && (
                <p className="mt-2 text-sm text-red-600 font-medium">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl"
              disabled={isLoading}
            >
              {isLoading ? '登录中...' : '登录'}
            </Button>
          </form>

          <div className="mt-8 text-center pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              还没有账户？{' '}
              <a
                href="/register"
                className="font-bold text-primary-600 hover:text-primary-700 transition-colors duration-200"
              >
                立即注册
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
