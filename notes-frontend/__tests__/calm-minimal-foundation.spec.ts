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
})
