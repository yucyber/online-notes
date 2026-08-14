import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, type AtRule, type Container, type Rule } from 'postcss'

const readProductCss = (relativePath: string) => (
  parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8'))
)

const findRule = (container: Container, selector: string, requiredDeclaration?: string) => {
  let match: Rule | undefined
  container.walkRules((rule) => {
    const selectors = rule.selector.split(',').map((part) => part.trim())
    const hasDeclaration = !requiredDeclaration || rule.nodes.some(
      (node) => node.type === 'decl' && node.prop === requiredDeclaration,
    )
    if (!match && selectors.includes(selector) && hasDeclaration) match = rule
  })
  expect(match).toBeDefined()
  return match as Rule
}

const declarations = (rule: Rule) => {
  const values = new Map<string, { value: string; important: boolean }>()
  rule.walkDecls((declaration) => {
    values.set(declaration.prop, { value: declaration.value, important: declaration.important })
  })
  return values
}

const findMedia = (container: Container, params: string) => {
  let match: AtRule | undefined
  container.walkAtRules('media', (rule) => {
    if (!match && rule.params === params) match = rule
  })
  expect(match).toBeDefined()
  return match as AtRule
}

describe('编辑器真实 CSS 响应式契约', () => {
  test('暗色主题沿用全站中性炭黑层级而不改变编辑器结构', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/styles/editor-tokens.css'), 'utf8')

    expect(source).toContain('html[data-theme="editor-dark"]')
    expect(source).toContain('--bg: #181817')
    expect(source).toContain('--bg-elev: #232322')
    expect(source).not.toContain('--bg: #0b1220')
    expect(source).not.toContain('--bg-elev: #0f172a')
  })

  test('1023px 以下切为单列覆盖层并限制正文和工具栏横向溢出', () => {
    const css = readProductCss('src/styles/editor-tokens.css')
    const grid = declarations(findRule(css, '.editor-layout-grid', 'grid-template-columns'))
    const main = declarations(findRule(css, '.editor-layout-main', 'min-width'))
    const editor = declarations(findRule(css, '.editor-rich-editor'))
    const toolbar = declarations(findRule(css, '.editor-toolbar', 'min-width'))
    const tools = declarations(findRule(css, '.editor-toolbar__tools', 'min-width'))

    expect(grid.get('grid-template-columns')?.value).toBe(
      'var(--editor-left-width) minmax(0, 1fr)',
    )
    expect(main.get('min-width')?.value).toBe('0')
    expect(main.get('overflow')?.value).toBe('hidden')
    expect(editor.get('width')?.value).toBe('100%')
    expect(editor.get('min-width')?.value).toBe('0')
    expect(toolbar.get('min-width')?.value).toBe('0')
    expect(toolbar.get('max-width')?.value).toBe('100%')
    expect(toolbar.get('overflow')?.value).toBe('hidden')
    expect(tools.get('min-width')?.value).toBe('0')
    expect(tools.get('overflow-x')?.value).toBe('visible')

    const compact = findMedia(css, '(max-width: 1023px)')
    expect(declarations(findRule(compact, '.editor-layout-grid')).get('grid-template-columns')?.value)
      .toBe('minmax(0, 1fr)')
    const compactMain = declarations(findRule(compact, '.editor-layout-main'))
    expect(compactMain.get('grid-column')?.value).toBe('1')
    expect(compactMain.get('grid-row')?.value).toBe('1')
    expect(declarations(findRule(compact, '.editor-left-navigation', 'position')).get('position')?.value).toBe('fixed')
    expect(declarations(findRule(compact, '.editor-right-metadata', 'position')).get('position')?.value).toBe('fixed')
    expect(declarations(findRule(compact, '.editor-left-navigation', 'left')).get('left')?.value).toBe('0')
    expect(declarations(findRule(compact, '.editor-left-navigation', 'width')).get('width')?.value).toBe('var(--editor-left-width)')
    expect(declarations(findRule(compact, '.editor-right-metadata', 'right')).get('right')?.value).toBe('0')
    expect(declarations(findRule(compact, '.editor-layout-grid[data-right-collapsed="true"] .editor-right-metadata')).get('display')?.value)
      .toBe('none')
    expect(declarations(findRule(compact, '.editor-layout-resizer')).get('display')?.value).toBe('none')
  })

  test('reduced-motion 覆盖编辑器布局及所有 pseudo-elements', () => {
    const globals = readProductCss('src/app/globals.css')
    const reducedMotion = findMedia(globals, '(prefers-reduced-motion: reduce)')
    const universalRule = findRule(reducedMotion, '*')
    const selectors = universalRule.selector.split(',').map((part) => part.trim())
    const reducedDeclarations = declarations(universalRule)

    expect(selectors).toEqual(expect.arrayContaining(['*', '*::before', '*::after']))
    expect(reducedDeclarations.get('animation')).toEqual({ value: 'none', important: true })
    expect(reducedDeclarations.get('transition')).toEqual({ value: 'none', important: true })
  })
})
