import fs from 'fs'
import path from 'path'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('原型交互视觉回归', () => {
  test('桌面侧栏收起时应用单列壳，主内容不落入 224px 网格列', () => {
    const layout = read('src/app/dashboard/layout.tsx')
    const css = read('src/styles/product-tokens.css')
    expect(layout).toContain("isSidebarHidden ? 'app-shell app-shell--sidebar-hidden' : 'app-shell'")
    expect(css).toContain('.app-shell--sidebar-hidden { grid-template-columns: minmax(0, 1fr); }')
  })

  test('墨点助手启动器横向排布字标与星标', () => {
    const source = read('src/components/ai/AIPet.tsx')
    expect(source).toContain('inline-flex')
    expect(source).not.toContain('grid h-[46px] w-[46px]')
  })

  test('筛选器和分页完全使用原型类而非旧 Tailwind 表面', () => {
    const search = read('src/components/SearchFilterBar.tsx')
    const pagination = read('src/components/ui/pagination.tsx')
    expect(search).toContain('prototype-search-toolbar')
    expect(search).toContain('prototype-filter-select')
    expect(search).toContain('prototype-filter-popover')
    expect(pagination).toContain('prototype-pager-buttons')
    expect(pagination).toContain('prototype-page-button')
    expect(pagination).toContain('prototype-page-size')
    expect(pagination).not.toContain('px-2 py-1 border rounded')
  })

  test('编辑器核心按钮采用项目原型 SVG 图标集', () => {
    const toolbar = read('src/components/editor/TiptapToolbar.tsx')
    const header = read('src/components/editor/NoteEditorHeader.tsx')
    const sidebar = read('src/components/editor/EditorWorkspaceSidebar.tsx')
    expect(toolbar).toContain('PrototypeGlyph')
    expect(header).toContain('PrototypeGlyph')
    expect(sidebar).toContain('PrototypeGlyph')
    expect(toolbar).not.toContain("from 'lucide-react'")
    expect(header).not.toContain("from 'lucide-react'")
    expect(sidebar).not.toContain("from 'lucide-react'")
  })

  test('工作台导航 SVG 保持原型的无 viewBox 渲染方式', () => {
    const navigation = read('src/components/dashboard/dashboard-navigation.tsx')
    expect(navigation).toContain('return <svg aria-hidden="true">')
    expect(navigation).not.toContain('return <svg aria-hidden="true" viewBox="0 0 24 24">')
  })

  test('笔记页使用原型整页宽度、工具栏结构和顶栏图标渲染', () => {
    const css = read('src/styles/product-tokens.css')
    const search = read('src/components/SearchFilterBar.tsx')
    const navigation = read('src/components/dashboard/dashboard-navigation.tsx')
    expect(css).toContain('max-width: 1260px;')
    expect(css).toContain('.prototype-search-shell { position: relative; margin-bottom: 22px;')
    expect(css).toContain('.prototype-search-box svg { width: 14px; height: 14px; flex: none; fill: none;')
    expect(search).toContain('prototype-filter-select')
    expect(search).toContain('prototype-filter-popover')
    expect(search).not.toContain('prototype-filter-button')
    expect(navigation).not.toContain('<svg viewBox="0 0 24 24">')
    expect(navigation).toContain('M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z')
    const notesPage = read('src/app/dashboard/notes/page.tsx')
    expect(notesPage.indexOf('prototype-notes-layout')).toBeLessThan(notesPage.lastIndexOf('prototype-section-head'))
    expect(read('src/components/SmartRecommendations.tsx')).not.toContain('text-xs rounded p-3 border')
  })

  test('知识库创建表单默认收起，笔记筛选和语义搜索都有实际执行入口', () => {
    const knowledgeBasePage = read('src/app/dashboard/knowledge-bases/page.tsx')
    const search = read('src/components/SearchFilterBar.tsx')
    const hook = read('src/components/useSearchFilterBar.ts')
    expect(knowledgeBasePage).toContain('useState(false)')
    expect(search).toContain('prototype-filter-action')
    expect(search).toContain('page.handleSearch()')
    expect(search).toContain('page.handleSemanticSearch()')
    expect(hook).toContain('const handleSemanticSearch = () =>')
    expect(hook).toContain("params.set('nlq', '1')")
  })

  test('知识库与分类页头和分类编辑面板保持原型的可见结构', () => {
    const knowledgeBasePage = read('src/app/dashboard/knowledge-bases/page.tsx')
    const categoriesPage = read('src/app/dashboard/categories/page.tsx')
    expect(knowledgeBasePage).not.toContain('<PrototypeGlyph name="plus" />新建知识库')
    expect(categoriesPage).not.toContain('<PrototypeGlyph name="plus" />新建分类')
    expect(categoriesPage).not.toContain('prototype-color-field')
    expect(categoriesPage).not.toContain('aria-label="父级分类"')
  })

  test('笔记悬浮预览使用原型尺寸和主题变量，暗色下不出现白色卡片', () => {
    const preview = read('src/components/notes/NoteHoverPreview.tsx')
    const css = read('src/styles/product-tokens.css')
    expect(preview).toContain('prototype-note-preview')
    expect(preview).not.toContain('bg-white')
    expect(preview).not.toContain('var(--primary-50)')
    expect(css).toContain('width: 310px;')
    expect(css).toContain('background: var(--product-panel);')
    expect(css).toContain('border: 1px solid var(--product-line-strong);')
  })

  test('筛选和语义搜索点击后展示可操作选项并执行查询', () => {
    const search = read('src/components/SearchFilterBar.tsx')
    const hook = read('src/components/useSearchFilterBar.ts')
    expect(search).toContain('page.handleFilterToggle()')
    expect(search).toContain('prototype-filter-popover')
    expect(search).toContain('prototype-semantic-popover')
    expect(search).toContain('page.handleSemanticMode')
    expect(search).toContain('page.handleClear()')
    expect(hook).toContain('const handleSemanticMode = (mode:')
    expect(hook).toContain('nlqMode: mode')
    expect(hook).toContain('setIsSemanticOpen(false)')
    expect(search).toContain('关闭语义搜索')
  })
  test('note rows vertically center their content within the prototype row height', () => {
    const css = read('src/styles/product-tokens.css')
    expect(css).toContain('.prototype-note-row { display: grid; align-items: center; }')
  })
})
