import { AxiosError, type AxiosAdapter } from 'axios'
import api from '@/lib/api/client'
import { authAPI } from '@/lib/api/auth'

const originalAdapter = api.defaults.adapter

afterEach(() => {
  api.defaults.adapter = originalAdapter
  jest.useRealTimers()
})

test('验证码发送使用 15 秒期限，登录继续使用默认 3 秒', async () => {
  const requests: { url?: string; timeout?: number }[] = []
  api.defaults.adapter = async config => {
    requests.push({ url: config.url, timeout: config.timeout })
    return { data: { message: 'ok' }, status: 200, statusText: 'OK', headers: {}, config }
  }
  await authAPI.sendEmailCode('user@example.com')
  await authAPI.login({ email: 'user@example.com', password: 'secret1' })
  expect(requests).toEqual([
    { url: '/auth/email-code', timeout: 15_000 },
    { url: '/auth/login', timeout: 3_000 },
  ])
})

test('SMTP 3.5 秒成功仍返回发送成功', async () => {
  jest.useFakeTimers()
  const delayedAdapter: AxiosAdapter = config => new Promise((resolve, reject) => {
    const responseTimer = setTimeout(() => {
      clearTimeout(timeoutTimer)
      resolve({ data: { message: 'sent' }, status: 200, statusText: 'OK', headers: {}, config })
    }, 3_500)
    const timeoutTimer = setTimeout(() => {
      clearTimeout(responseTimer)
      reject(new AxiosError('timeout', 'ECONNABORTED', config))
    }, config.timeout)
  })
  api.defaults.adapter = delayedAdapter
  const result = authAPI.sendEmailCode('user@example.com').then(data => ({ data }), error => ({ error }))
  await jest.advanceTimersByTimeAsync(3_500)
  expect(await result).toEqual({ data: { message: 'sent' } })
})

test('发送失败仍通过统一错误处理返回原始 HTTP 错误', async () => {
  api.defaults.adapter = async config => {
    throw new AxiosError('SMTP unavailable', 'ERR_BAD_RESPONSE', config, undefined, {
      data: { message: '邮件服务暂时不可用' }, status: 503, statusText: 'Unavailable', headers: {}, config,
    })
  }
  await expect(authAPI.sendEmailCode('user@example.com')).rejects.toMatchObject({ response: { status: 503 } })
})
