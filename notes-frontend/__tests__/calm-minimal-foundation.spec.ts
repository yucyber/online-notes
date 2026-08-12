import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Calm Minimal 全局界面基础契约', () => {
  test('全站加载独立产品 token，并由 Dashboard 使用统一页面壳层', () => {
    expect(read('src/app/layout.tsx')).toContain("import '@/styles/product-tokens.css'")

    const dashboardLayout = read('src/app/dashboard/layout.tsx')
    expect(dashboardLayout).toContain('app-shell')
    expect(dashboardLayout).toContain('app-main')
    expect(dashboardLayout).toContain('page-container')
    expect(dashboardLayout).not.toContain("rounded-xl p-4 md:p-6 bg-[var(--surface-1)] border shadow-sm")
  })

  test('基础按钮和卡片不依赖 React hover state、渐变或位移动画', () => {
    const button = read('src/components/ui/button.tsx')
    const card = read('src/components/ui/card.tsx')

    expect(button).not.toContain('useState')
    expect(button).not.toContain('backgroundImage')
    expect(button).not.toContain('setTimeout')
    expect(button).toContain("default: 'h-11")
    expect(button).toContain("icon: 'h-11 w-11")
    expect(button).toContain('focus-visible:ring-2')
    expect(card).not.toContain('useState')
    expect(card).not.toContain('translateY')
    expect(card).not.toContain('scale(')
  })

  test('侧栏和第一批页面不再使用装饰渐变或绿色品牌块', () => {
    const files = [
      'src/components/dashboard/dashboard-navigation.tsx',
      'src/app/dashboard/page.tsx',
      'src/app/dashboard/categories/page.tsx',
      'src/app/dashboard/tags/page.tsx',
    ]

    for (const file of files) {
      const source = read(file)
      expect(source).not.toContain('linear-gradient')
      expect(source).not.toContain('radial-gradient')
      expect(source).not.toContain('#10b981')
    }
  })

  test('知识库和 AI 入口沿用同一标题与克制强调色', () => {
    const knowledgeBasePage = read('src/app/dashboard/knowledge-bases/page.tsx')
    const aiChat = read('src/components/ai/ChatWindow.tsx')
    const aiEntry = read('src/components/ai/AIPet.tsx')

    expect(knowledgeBasePage).toContain('page-heading')
    expect(aiChat).not.toContain('purple')
    expect(aiEntry).not.toContain('group-hover:-translate-y')
    expect(aiEntry).not.toContain('shadow-xl')
  })

  test('核心页面内容不再使用旧的浮动卡片和厚重 AI 面板', () => {
    const dashboard = read('src/app/dashboard/page.tsx')
    const categories = read('src/components/categories/CategoryListPanel.tsx')
    const tags = read('src/app/dashboard/tags/page.tsx')
    const aiChat = read('src/components/ai/ChatWindow.tsx')

    for (const source of [dashboard, categories, tags]) {
      expect(source).not.toContain('card-hover')
      expect(source).not.toContain('hover:-translate-y')
      expect(source).not.toContain('shadow-2xl')
    }
    expect(dashboard).not.toContain('text-gray-900')
    expect(tags).toContain('page-heading')
    expect(aiChat).toContain('border-[var(--product-line)]')
    expect(aiChat).not.toContain('shadow-2xl')
    expect(aiChat).not.toContain('slide-in-from-bottom')
  })

  test('扩展页面与认证页使用 Calm Minimal 标题和背景', () => {
    const pages = [
      'src/app/dashboard/activity/page.tsx',
      'src/app/dashboard/notifications/page.tsx',
      'src/app/dashboard/settings/page.tsx',
      'src/app/(auth)/login/page.tsx',
      'src/app/(auth)/register/page.tsx',
    ].map(read)

    for (const source of pages) {
      expect(source).not.toContain('linear-gradient')
      expect(source).not.toContain('bg-gradient')
      expect(source).not.toContain('shadow-xl')
    }
    expect(pages[0]).toContain('page-heading')
    expect(pages[1]).toContain('page-heading')
    expect(pages[2]).toContain('page-heading')
    for (const authPage of pages.slice(3)) {
      expect(authPage).toContain('bg-[var(--product-bg)]')
      expect(authPage).toContain('text-[var(--product-text-secondary)]')
      expect(authPage).not.toContain('text-gray-600')
    }
  })

  test('编辑器路由使用专用工作区而不叠加 Dashboard 壳层', () => {
    const layout = read('src/app/dashboard/layout.tsx')

    expect(layout).toContain('isEditorWorkspaceRoute')
    expect(layout).toContain('editor-workspace-route')
    expect(layout.indexOf('editor-workspace-route')).toBeLessThan(layout.indexOf('<DashboardSidebar'))
  })

  test('编辑器正文不显示开发诊断和常驻手动保存操作', () => {
    const editor = read('src/components/editor/TiptapEditor.tsx')

    expect(editor).not.toContain('ws[{wsDebug.connected')
    expect(editor).not.toContain('连接状态：')
    expect(editor).not.toContain('>重连</Button>')
  })

  test('窄屏抽屉在自身内部提供收起入口', () => {
    const sidebar = read('src/components/editor/EditorWorkspaceSidebar.tsx')
    const tokens = read('src/styles/editor-tokens.css')

    expect(sidebar).toContain('editor-workspace-sidebar__mobile-close')
    expect(tokens).toContain('.editor-workspace-sidebar__mobile-close')
  })

  test('工作台导航使用平面分组且不持续展开技术状态', () => {
    const navigation = read('src/components/dashboard/dashboard-navigation.tsx')

    expect(navigation).toContain('主导航')
    expect(navigation).toContain('管理')
    expect(navigation).toContain('dashboard-nav-item')
    expect(navigation).not.toContain('item.hint')
    expect(navigation).not.toContain('h-6 w-1 rounded-full')
    expect(navigation).not.toContain('<NetworkStatus')
  })

  test('笔记管理页使用紧凑平面列表', () => {
    const dashboard = read('src/app/dashboard/page.tsx')
    const page = read('src/app/dashboard/notes/page.tsx')
    const item = read('src/components/notes/NotesListCard.tsx')
    const search = read('src/components/SearchFilterBar.tsx')

    expect(dashboard).toContain('product-page-header')
    expect(page).toContain('product-page-header')
    expect(page).toContain('product-list-surface')
    expect(page).not.toContain('linear-gradient')
    expect(page).not.toContain('radial-gradient')
    expect(item).toContain('notes-list-item')
    expect(item).not.toContain("translateY('-4px')")
    expect(search).toContain('product-toolbar')
    expect(search).not.toContain('shadow mb-6')
  })

  test('核心管理页共享统一标题区', () => {
    const pages = ['activity', 'categories', 'knowledge-bases', 'notifications', 'settings', 'tags']

    pages.forEach((name) => {
      expect(read(`src/app/dashboard/${name}/page.tsx`)).toContain('product-page-header')
    })
  })
})
