'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { register } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isValidEmail, isStrongPassword } from '@/utils'
import { persistAuthSession } from '@/lib/auth'

const registerSchema = z.object({
  email: z
    .string()
    .email('请输入有效的邮箱地址')
    .refine((email) => isValidEmail(email), '邮箱格式不正确'),
  password: z
    .string()
    .min(6, '密码至少6个字符')
    .max(50, '密码不能超过50个字符')
    .refine((password) => isStrongPassword(password), '密码必须包含字母和数字'),
  confirmPassword: z
    .string()
    .min(6, '确认密码至少6个字符'),
}).refine((data) => data.password === data.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword'],
})

type RegisterFormValues = z.infer<typeof registerSchema>

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      setIsLoading(true)
      setError('')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { confirmPassword: _confirmPassword, ...registerData } = values
      const result = await register(registerData)
      persistAuthSession(result.token, result.user)
      router.push('/dashboard/notes')
      router.refresh()
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.response?.data?.message || '注册失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

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
            创建账户
          </h1>
          <p className="text-gray-600 text-lg">
            请填写以下信息完成注册
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
                placeholder="请输入密码（至少6位，包含字母和数字）"
                disabled={isLoading}
                {...form.register('password')}
                autoComplete="new-password"
                className={`h-12 text-base ${form.formState.errors.password ? 'border-red-500 ring-2 ring-red-200' : ''}`}
              />
              {form.formState.errors.password && (
                <p className="mt-2 text-sm text-red-600 font-medium">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-bold text-gray-700 mb-2">
                确认密码
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="请再次输入密码"
                disabled={isLoading}
                {...form.register('confirmPassword')}
                autoComplete="new-password"
                className={`h-12 text-base ${form.formState.errors.confirmPassword ? 'border-red-500 ring-2 ring-red-200' : ''}`}
              />
              {form.formState.errors.confirmPassword && (
                <p className="mt-2 text-sm text-red-600 font-medium">
                  {form.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl"
              disabled={isLoading}
            >
              {isLoading ? '注册中...' : '注册'}
            </Button>
          </form>

          <div className="mt-8 text-center pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              已有账户？{' '}
              <a
                href="/login"
                className="font-bold text-primary-600 hover:text-primary-700 transition-colors duration-200"
              >
                立即登录
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}