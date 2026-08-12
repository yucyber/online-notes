import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import NetworkStatus from '@/components/security/NetworkStatus'
import AIPet from '@/components/ai/AIPet'
import { DashboardSidebar, shouldUseOverlaySidebar } from '@/components/dashboard/dashboard-navigation'
import { networkAPI } from '@/lib/api'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'
import { NoteEditorMetadataPanel } from '@/components/editor/NoteEditorMetadataPanel'
import NoteEditorShell from '@/components/editor/NoteEditorShell'
import { AppToastCard, AppToaster } from '@/components/ui/AppToaster'

const mockToastDismiss = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => <div data-testid="dynamic-editor" />,
}))
jest.mock('marked', () => ({ marked: { parse: jest.fn() } }))
jest.mock('react-hot-toast', () => ({
  Toaster: ({ position }: { position: string }) => <div data-testid="toast-position" data-position={position} />,
  toast: { dismiss: (...args: unknown[]) => mockToastDismiss(...args) },
}))
jest.mock('@/components/ai/ChatWindow', () => ({ __esModule: true, default: () => null }))
jest.mock('@/lib/api', () => ({
  networkAPI: { ping: jest.fn() },
  fetchCategories: jest.fn(() => new Promise(() => {})),
  fetchTags: jest.fn(() => new Promise(() => {})),
  updateNote: jest.fn(),
  lockNote: jest.fn(),
  unlockNote: jest.fn(),
  boardsAPI: { create: jest.fn() },
  mindmapsAPI: { create: jest.fn() },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: () => null }))
jest.mock('@/components/editor/TiptapToolbar', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('@/components/editor/NoteEditorDrawers', () => ({ NoteEditorDrawers: () => null }))
jest.mock('@/components/editor/useNoteSave', () => ({
  useNoteSave: () => ({ handleSave: jest.fn(), handleSaveDraft: jest.fn(), addTagsByNames: jest.fn() }),
}))
jest.mock('@/components/editor/useEditorAutoSave', () => ({
  useEditorAutoSave: () => ({ state: { status: 'saved' }, saveNow: jest.fn() }),
}))
jest.mock('@/components/editor/note-permissions', () => ({
  canWriteNote: () => true,
  shouldManageNoteLock: () => false,
}))

let animationFrame: FrameRequestCallback | undefined

describe('编辑页窄视口布局', () => {
  beforeEach(() => {
    ;(networkAPI.ping as jest.Mock).mockResolvedValue({ latency: 20, ok: true, status: 200 })
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: jest.fn() })
    animationFrame = undefined
    mockToastDismiss.mockClear()
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { animationFrame = callback; return 1 } })
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

    const restore = screen.getByRole('button', { name: '展开右侧面板' })
    expect(restore.parentElement).toHaveStyle({ width: '52px' })
    restore.focus()
    expect(restore).toHaveFocus()
  })

  test('左右恢复按钮分别响应 Enter 和 Space，并释放正文轨道宽度', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [], visibility: 'private' } as any
    const { container } = render(<NoteEditorShell id="n1" initialData={note} />)
    const grid = container.querySelector('.editor-layout-grid') as HTMLElement
    const main = container.querySelector('.editor-layout-main') as HTMLElement
    const productCss = readFileSync(resolve(process.cwd(), 'src/styles/editor-tokens.css'), 'utf8')
    const gridTracks = () => [
      grid.style.getPropertyValue('--editor-left-width'),
      'minmax(0, 1fr)',
      grid.style.getPropertyValue('--editor-right-width'),
    ]

    expect(main).toBeInTheDocument()
    expect(productCss).toMatch(/\.editor-layout-grid\s*\{[^}]*grid-template-columns:\s*var\(--editor-left-width\) minmax\(0, 1fr\) var\(--editor-right-width\)/s)
    expect(productCss).toMatch(/\.editor-layout-main\s*\{[^}]*min-width:\s*0/s)
    expect(gridTracks()).toEqual(['236px', 'minmax(0, 1fr)', '280px'])

    fireEvent.click(screen.getByRole('button', { name: '收起左侧导航' }))
    act(() => animationFrame?.(0))
    const leftRestore = within(container.querySelector('#editor-left-navigation') as HTMLElement)
      .getByRole('button', { name: '展开左侧导航' })
    expect(leftRestore).toHaveFocus()
    expect(gridTracks()).toEqual(['52px', 'minmax(0, 1fr)', '280px'])

    fireEvent.keyDown(leftRestore, { key: 'Enter', code: 'Enter' })
    fireEvent.keyUp(leftRestore, { key: 'Enter', code: 'Enter' })
    expect(screen.getByRole('button', { name: '收起左侧导航' })).toBeInTheDocument()
    expect(gridTracks()).toEqual(['236px', 'minmax(0, 1fr)', '280px'])

    fireEvent.click(screen.getByRole('button', { name: '收起右侧面板' }))
    act(() => animationFrame?.(0))
    const rightRestore = within(container.querySelector('#editor-right-metadata') as HTMLElement)
      .getByRole('button', { name: '展开右侧面板' })
    expect(rightRestore).toHaveFocus()
    expect(gridTracks()).toEqual(['236px', 'minmax(0, 1fr)', '52px'])

    fireEvent.keyDown(rightRestore, { key: ' ', code: 'Space' })
    fireEvent.keyUp(rightRestore, { key: ' ', code: 'Space' })
    expect(screen.getByRole('button', { name: '收起右侧面板' })).toBeInTheDocument()
    expect(gridTracks()).toEqual(['236px', 'minmax(0, 1fr)', '280px'])
  })

  test('Toast action 暴露明确名称并可由键盘操作', () => {
    const retry = jest.fn()
    render(
      <AppToastCard
        toastId="save:n1"
        tone="error"
        title="保存失败"
        action={{ label: '重新保存', onClick: retry }}
      />,
    )

    const action = screen.getByRole('button', { name: '重新保存' })
    action.focus()
    expect(action).toHaveFocus()
    fireEvent.click(action)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test('统一 Toast 与 AI 入口分别锚定右上和右下', () => {
    render(
      <>
        <AppToaster />
        <AIPet />
      </>,
    )

    expect(screen.getByTestId('toast-position')).toHaveAttribute('data-position', 'top-right')
    expect(screen.getByRole('button', { name: '切换 AI 助手' })).toHaveClass('fixed', 'bottom-4', 'right-4')
  })

  test('拖拽实时调整左栏，提交后才持久化，Escape 恢复起始宽度', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [], visibility: 'private' } as any
    const { container } = render(<NoteEditorShell id="n1" initialData={note} />)
    const grid = container.querySelector('.editor-layout-grid') as HTMLElement
    const resizer = screen.getByRole('separator', { name: '调整左侧导航宽度' })

    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 236 }))
    fireEvent(resizer, new MouseEvent('pointermove', { bubbles: true, clientX: 296 }))
    expect(grid.style.getPropertyValue('--editor-left-width')).toBe('296px')
    expect(localStorage.getItem('notes:editor-layout:v1')).toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(grid.style.getPropertyValue('--editor-left-width')).toBe('236px')
    expect(localStorage.getItem('notes:editor-layout:v1')).toBeNull()

    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 236 }))
    fireEvent(resizer, new MouseEvent('pointermove', { bubbles: true, clientX: 296 }))
    fireEvent(resizer, new MouseEvent('pointerup', { bubbles: true, clientX: 296 }))
    expect(JSON.parse(localStorage.getItem('notes:editor-layout:v1') || '{}')).toMatchObject({ leftWidth: 296 })
  })

  test('宽屏收起右侧后保留可见恢复轨道并转移焦点', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [], visibility: 'private' } as any
    const { container } = render(<NoteEditorShell id="n1" initialData={note} />)

    fireEvent.click(screen.getByRole('button', { name: '收起右侧面板' }))
    act(() => animationFrame?.(0))

    const restore = within(container.querySelector('#editor-right-metadata') as HTMLElement).getByRole('button', { name: '展开右侧面板' })
    expect((container.querySelector('.editor-layout-grid') as HTMLElement).style.getPropertyValue('--editor-right-width')).toBe('52px')
    expect(restore.parentElement).toHaveStyle({ width: '52px' })
    expect(restore).toHaveFocus()
  })

  test('编辑器使用单一工作区侧栏并将笔记属性放入右侧面板', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [], visibility: 'private' } as any
    const { container } = render(<NoteEditorShell id="n1" initialData={note} />)

    const navigation = screen.getByRole('complementary', { name: '编辑器导航' })
    expect(within(navigation).getByRole('button', { name: '返回工作台' })).toBeInTheDocument()
    expect(within(navigation).getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument()

    const properties = screen.getByRole('complementary', { name: '笔记属性' })
    expect(within(properties).getByText('选择分类')).toBeInTheDocument()
    expect(container.querySelector('.editor-top-properties')).not.toBeInTheDocument()
  })
})
