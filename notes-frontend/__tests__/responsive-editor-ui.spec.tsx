import { render, screen } from '@testing-library/react'
import NetworkStatus from '@/components/security/NetworkStatus'
import { DashboardSidebar, shouldUseOverlaySidebar } from '@/components/dashboard/dashboard-navigation'
import { networkAPI } from '@/lib/api'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'
import { NoteEditorMetadataPanel } from '@/components/editor/NoteEditorMetadataPanel'

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

  test('左右面板有独立的可访问收起控制', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [] } as any
    const onToggleLeft = jest.fn()
    const onToggleRight = jest.fn()

    render(
      <NoteEditorHeader
        note={note}
        editorMode="rich"
        leftCollapsed={false}
        rightCollapsed={false}
        onBack={() => undefined}
        onModeChange={() => undefined}
        onVisibilityChange={() => undefined}
        onToggleLeft={onToggleLeft}
        onToggleRight={onToggleRight}
        onOpenCollab={() => undefined}
      />,
    )

    const left = screen.getByRole('button', { name: '收起左侧导航' })
    const right = screen.getByRole('button', { name: '收起右侧面板' })
    expect(left).toHaveAttribute('aria-controls', 'editor-left-navigation')
    expect(left).toHaveAttribute('aria-expanded', 'true')
    expect(right).toHaveAttribute('aria-controls', 'editor-right-metadata')
    expect(right).toHaveAttribute('aria-expanded', 'true')
  })

  test('收起右侧时元数据面板保留恢复按钮', () => {
    render(
      <NoteEditorMetadataPanel
        id="n1"
        toc={[]}
        collapsed
        isFullscreen={false}
        onToggle={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '展开右侧面板' })).toBeInTheDocument()
  })
})
