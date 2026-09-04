import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/styles/product-tokens.css'), 'utf8')

describe('整理提案页产品 token 与响应式契约', () => {
  test('桌面为双栏并在窄屏切成单列，避免横向溢出', () => {
    expect(css).toContain('.organizer-layout {')
    expect(css).toContain('grid-template-columns: 300px minmax(0, 1fr)')
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.organizer-layout \{ grid-template-columns: 1fr; \}/)
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.organizer-execution-item \{\s*grid-template-columns: 1fr;/)
  })

  test('执行确认影响范围列表可滚动且适配窄屏内容', () => {
    expect(css).toContain('.organizer-execute-scope')
    expect(css).toContain('max-height: 220px;')
    expect(css).toContain('overflow: auto;')
  })

  test('暗色模式继续使用 product tokens 变量而非硬编码白底', () => {
    expect(css).toContain('[data-theme="dark"] .organizer-warning')
    expect(css).toContain('[data-theme="dark"] .risk-low')
    expect(css).toContain('[data-theme="dark"] .risk-high')
    expect(css).toContain('.organizer-page { color: var(--product-text); }')
    expect(css).toContain('background: var(--product-panel-soft);')
  })
})
