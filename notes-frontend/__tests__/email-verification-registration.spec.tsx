import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RegisterPage from '@/app/(auth)/register/page'
import LoginPage from '@/app/(auth)/login/page'
import { login, register, sendEmailCode } from '@/lib/api'

const mockPush = jest.fn()
const mockRefresh = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/lib/api', () => ({
  login: jest.fn(),
  register: jest.fn(),
  sendEmailCode: jest.fn(),
}))

jest.mock('@/lib/auth', () => ({
  persistAuthSession: jest.fn(),
}))

const mockedLogin = jest.mocked(login)
const mockedRegister = jest.mocked(register)
const mockedSendEmailCode = jest.mocked(sendEmailCode)

describe('邮箱验证码注册', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('展示验证码输入框和获取验证码按钮', () => {
    render(<RegisterPage />)

    expect(screen.getByLabelText('验证码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeInTheDocument()
  })

  it('邮箱非法时不请求验证码', async () => {
    render(<RegisterPage />)

    fireEvent.change(screen.getByLabelText('邮箱地址'), {
      target: { value: 'invalid-email' },
    })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect(await screen.findByText('请输入有效的邮箱地址')).toBeInTheDocument()
    expect(mockedSendEmailCode).not.toHaveBeenCalled()
  })

  it('邮箱合法时发送验证码并倒计时，卸载后清理 timer', async () => {
    jest.useFakeTimers()
    mockedSendEmailCode.mockResolvedValue({ message: '验证码已发送' })
    const view = render(<RegisterPage />)

    fireEvent.change(screen.getByLabelText('邮箱地址'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() => {
      expect(mockedSendEmailCode).toHaveBeenCalledWith('user@example.com')
    })
    expect(screen.getByRole('button', { name: '60秒后重试' })).toBeDisabled()

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: '59秒后重试' })).toBeDisabled()

    view.unmount()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('注册提交验证码且不提交确认密码', async () => {
    mockedRegister.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
      },
    })
    render(<RegisterPage />)

    fireEvent.change(screen.getByLabelText('邮箱地址'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'pass123' },
    })
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'pass123' },
    })
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))

    await waitFor(() => {
      expect(mockedRegister).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'pass123',
        verificationCode: '123456',
      })
    })
  })
})

describe('登录安全回归', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams(
      'auto=1&email=user%40example.com&password=pass123',
    )
  })

  it('auto=1 登录收到 401 时只展示错误，不自动注册', async () => {
    mockedLogin.mockRejectedValue({
      response: { status: 401, data: { message: '邮箱或密码错误' } },
    })
    render(<LoginPage />)

    expect(await screen.findByText('邮箱或密码错误')).toBeInTheDocument()
    expect(mockedRegister).not.toHaveBeenCalled()
  })
})
