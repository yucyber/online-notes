import { fireEvent, render, screen, within } from '@testing-library/react'
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
}))

describe('编辑页窄视口布局', () => {
  beforeEach(() => {
    ;(networkAPI.ping as jest.Mock).mockResolvedValue({ latency: 20, ok: true, status: 200 })
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: jest.fn() })
    mockToastDismiss.mockClear()
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

    expect(container.querySelector('aside')).toHaveClass('dashboard-sidebar')
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

  test('页头集中评论、协作和属性入口', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [] } as any
    const onToggleProperties = jest.fn()

    render(
      <NoteEditorHeader
        note={note}
        editorMode="rich"
        onOpenComments={() => undefined}
        onToggleProperties={onToggleProperties}
        propertiesOpen={false}
        onOpenCollab={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '打开评论' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开协作' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开笔记属性' }))
    expect(onToggleProperties).toHaveBeenCalledTimes(1)
  })

  test('笔记属性关闭时不渲染弹窗', () => {
    render(
      <NoteEditorMetadataPanel
        id="n1"
        open={false}
        panelRef={{ current: null }}
      />,
    )

    expect(screen.queryByRole('dialog', { name: '笔记属性' })).not.toBeInTheDocument()
  })

  test('左栏收起后释放轨道并保留边缘恢复触点', () => {
    const productCss = readFileSync(resolve(process.cwd(), 'src/styles/editor-tokens.css'), 'utf8')

    expect(productCss).toMatch(/\.editor-left-edge-trigger\s*\{/)
    expect(productCss).toMatch(/\.editor-sidebar-collapse-handle\s*\{/)
    expect(productCss).toMatch(/\.editor-sidebar-collapse-handle\s*\{[^}]*right:\s*-4px/s)
    expect(productCss).toMatch(/\.editor-sidebar-collapse-handle\s*\{[^}]*width:\s*20px/s)
    expect(productCss).toMatch(/\.editor-sidebar-collapse-handle\s*\{[^}]*height:\s*40px/s)
    expect(productCss).toMatch(/\.editor-workspace-sidebar\s*\{[^}]*gap:\s*12px/s)
    expect(productCss).toMatch(/\.editor-workspace-sidebar__search\s*\{[^}]*min-height:\s*40px/s)
    expect(productCss).toMatch(/\.editor-outline\s*\{[^}]*width:\s*220px/s)
    expect(productCss).toMatch(/\.editor-outline\s*\{[^}]*position:\s*fixed/s)
    expect(productCss).toMatch(/\.editor-layout-main\s*\{[^}]*min-width:\s*0/s)
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
    expect(screen.getByRole('button', { name: '打开墨点助手' })).toHaveClass('fixed', 'bottom-6', 'right-6')
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

  test('窄屏大纲作为右侧细条触点且无抽屉', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [], visibility: 'private' } as any
    render(<NoteEditorShell id="n1" initialData={note} />)

    // 大纲以 complementary 形式存在（三栏文档流）
    expect(screen.getByRole('complementary', { name: '大纲' })).toBeInTheDocument()
    // 旧抽屉已移除
    expect(screen.queryByRole('dialog', { name: '大纲' })).not.toBeInTheDocument()
  })

  test('编辑器使用笔记目录并通过页头打开属性弹窗', () => {
    const note = { id: 'n1', title: '布局测试', content: '', tags: [], visibility: 'private' } as any
    const { container } = render(<NoteEditorShell id="n1" initialData={note} />)

    const navigation = screen.getByRole('complementary', { name: '编辑器导航' })
    expect(within(navigation).getByRole('button', { name: '返回我的笔记' })).toBeInTheDocument()
    expect(within(navigation).getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开笔记属性' }))
    const properties = screen.getByRole('dialog', { name: '笔记属性' })
    expect(within(properties).getByText('选择分类')).toBeInTheDocument()
    expect(container.querySelector('.editor-top-properties')).not.toBeInTheDocument()
  })
  test('editor note directory matches the compact prototype treatment', () => {
    const sidebar = readFileSync(resolve(process.cwd(), 'src/components/editor/EditorWorkspaceSidebar.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/styles/editor-tokens.css'), 'utf8')

    expect(sidebar).not.toContain('<PrototypeGlyph name="file"')
    expect(css).toMatch(/\.editor-note-directory__item\s*\{[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.editor-note-directory__item\[data-active="true"\]\s*\{[^}]*border:\s*1px solid/s)
  })

  test('editor gives the document and outline independent full-height scroll surfaces', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/components/editor/NoteEditorShell.tsx'), 'utf8')
    const tiptap = readFileSync(resolve(process.cwd(), 'src/components/editor/TiptapEditor.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/styles/editor-tokens.css'), 'utf8')

    expect(shell).not.toContain('className="min-h-[calc(100vh-200px)]"')
    expect(css).toMatch(/\.editor-layout-grid\s*\{[^}]*height:\s*100dvh/s)
    expect(css).toMatch(/\.editor-edit-row \.editor-rich-editor\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)[^}]*overflow:\s*hidden/s)
    expect(css).toMatch(/\.editor-paper\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto[^}]*background:\s*var\(--editor-canvas-bg\)/s)
    expect(css).not.toMatch(/\.editor-paper\s*\{[^}]*min-height:\s*calc\(100dvh/s)
    expect(css).toMatch(/\.editor-outline\s*\{[^}]*height:\s*100%/s)
    expect(css).not.toMatch(/\.editor-outline\s*\{[^}]*border-left:\s*1px/s)
    expect(css).toMatch(/\.editor-outline__view\s*\{[^}]*overflow-y:\s*auto[^}]*overflow-x:\s*hidden/s)
    expect(css).toMatch(/\.editor-outline\[data-pinned="false"\]\s*\{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*width:\s*18px/s)
    expect(css).toMatch(/\.editor-left-navigation\s*\{[^}]*--editor-sidebar-bg:\s*var\(--product-panel-soft\)[^}]*background:\s*var\(--editor-sidebar-bg\)/s)
    expect(tiptap).not.toContain("background: 'var(--surface-1)'")
    expect(shell).toContain('event.currentTarget.blur()')
  })
})
