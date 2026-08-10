import { render, screen } from '@testing-library/react'
import NetworkStatus from '@/components/security/NetworkStatus'
import { DashboardSidebar, shouldUseOverlaySidebar } from '@/components/dashboard/dashboard-navigation'
import { networkAPI } from '@/lib/api'

jest.mock('@/lib/api', () => ({ networkAPI: { ping: jest.fn() } }))

describe('编辑页窄视口布局', () => {
  beforeEach(() => {
    ;(networkAPI.ping as jest.Mock).mockResolvedValue({ latency: 20, ok: true, status: 200 })
  })

  test('桌面侧栏仅在宽视口常驻，避免挤压编辑器', () => {
    const { container } = render(
      <DashboardSidebar
        pathname="/dashboard/notes/n1"
        isHidden={false}
        isMobileOpen={false}
        hoveredNav={null}
        onHover={() => undefined}
        onNavigate={() => undefined}
        onLogout={() => undefined}
        onCloseMobile={() => undefined}
      />,
    )

    expect(container.querySelector('aside')).toHaveClass('hidden', 'lg:flex')
  })

  test('侧栏按钮在 1024px 以下打开覆盖层导航', () => {
    expect(shouldUseOverlaySidebar(984)).toBe(true)
    expect(shouldUseOverlaySidebar(1024)).toBe(false)
  })

  test('网络状态操作保持单行且按钮有明确名称', async () => {
    render(<NetworkStatus onReconnect={() => undefined} />)

    expect(await screen.findByRole('button', { name: '重试网络连接' })).toHaveClass('whitespace-nowrap')
    expect(screen.getByRole('button', { name: '触发数据同步' })).toHaveClass('whitespace-nowrap')
  })
})
