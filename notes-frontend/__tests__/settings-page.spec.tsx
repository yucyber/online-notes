import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettingsPage from '@/app/dashboard/settings/page'
import { usersAPI } from '@/lib/api/users'
import { setCurrentUser } from '@/lib/auth'
import { toast } from 'react-hot-toast'
import { appToast } from '@/lib/app-toast'
import { DashboardHeader } from '@/components/dashboard/dashboard-navigation'

const replace = jest.fn()
const router = { replace }
const toggleLeft = jest.fn()
const setLeftWidth = jest.fn()
const setAutoSaveLayout = jest.fn()
const currentUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: '旧名称',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
}

jest.mock('next/navigation', () => ({
  useRouter: () => router,
}))

jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(() => currentUser),
  logout: jest.fn(async () => undefined),
  setCurrentUser: jest.fn(),
}))

jest.mock('@/lib/api/users', () => ({
  usersAPI: { updateProfile: jest.fn() },
}))

jest.mock('@/components/editor/useEditorLayoutPreferences', () => ({
  useEditorLayoutPreferences: () => ({
    preferences: { leftCollapsed: false, rightCollapsed: false, leftWidth: 280 },
    autoSaveLayout: true,
    toggleLeft,
    setLeftWidth,
    setAutoSaveLayout,
  }),
}))

jest.mock('@/lib/app-toast', () => ({
  appToast: { error: jest.fn() },
}))

jest.mock('react-hot-toast', () => ({
  toast: { success: jest.fn() },
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('saves a trimmed display name and synchronizes the current user cache', async () => {
    const updatedUser = { ...currentUser, displayName: '新名称' }
    jest.mocked(usersAPI.updateProfile).mockResolvedValue(updatedUser)
    render(<SettingsPage />)

    const displayNameInput = screen.getByLabelText('显示名称')
    fireEvent.input(displayNameInput, { target: { value: '  新名称  ' } })
    expect(displayNameInput).toHaveValue('  新名称  ')
    fireEvent.click(screen.getByRole('button', { name: '保存显示名称' }))

    await waitFor(() => {
      expect(usersAPI.updateProfile).toHaveBeenCalledWith({ displayName: '新名称' })
      expect(setCurrentUser).toHaveBeenCalledWith(updatedUser)
      expect(toast.success).toHaveBeenCalledWith('显示名称已更新')
    })
    expect(screen.getByLabelText('显示名称')).toHaveValue('新名称')
  })

  it('only exposes layout auto-save and keeps the settings navigation sticky on desktop', () => {
    render(<SettingsPage />)

    const autoSaveSwitch = screen.getByRole('switch', { name: '自动保存编辑器布局' })
    expect(autoSaveSwitch.querySelector('span')).toHaveClass('left-1')
    fireEvent.click(autoSaveSwitch)

    expect(setAutoSaveLayout).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('switch', { name: '折叠编辑器左栏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /220px|280px|360px/ })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '设置分组' })).toHaveClass('lg:sticky', 'lg:top-20', 'lg:self-start')
  })

  it('keeps the edited value and reports an API failure', async () => {
    jest.mocked(usersAPI.updateProfile).mockRejectedValue(new Error('网络不可用'))
    render(<SettingsPage />)

    const input = screen.getByLabelText('显示名称')
    fireEvent.change(input, { target: { value: '待保存名称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存显示名称' }))

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith(expect.objectContaining({
        id: 'settings:profile',
        message: '网络不可用',
      }))
    })
    expect(input).toHaveValue('待保存名称')
  })

  it('shows the updated display name in the dashboard user control', () => {
    render(
      <DashboardHeader
        pathname="/dashboard/settings"
        user={{ ...currentUser, displayName: '林默' }}
        isDark={false}
        isSidebarHidden={false}
        unreadCount={0}
        onToggleSidebar={jest.fn()}
        onToggleTheme={jest.fn()}
        onNavigate={jest.fn()}
        onLogout={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '打开用户菜单' })).toHaveTextContent('林')
    fireEvent.click(screen.getByRole('button', { name: '打开用户菜单' }))
    expect(screen.getByText('林默')).toBeInTheDocument()
  })
})
