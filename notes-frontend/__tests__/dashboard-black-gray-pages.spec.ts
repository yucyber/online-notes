import fs from 'fs'
import path from 'path'

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('真实工作台严格沿用交互原型结构', () => {
  test('仪表盘使用统计横带和最近笔记双栏', () => {
    const source = read('src/app/dashboard/page.tsx')
    expect(source).toContain('product-stat-strip')
    expect(source).toContain('product-split-layout')
    expect(source).toContain('最近笔记')
    expect(source).toContain('继续写作')
    expect(source).not.toContain('<TopicClusters')
  })

  test('活动日志和消息中心使用时间线与收件箱', () => {
    const activity = read('src/app/dashboard/activity/page.tsx')
    const notifications = read('src/app/dashboard/notifications/page.tsx')
    expect(activity).toContain('formatAuditEvent')
    expect(activity).toContain('product-timeline')
    expect(notifications).toContain('消息中心')
    expect(notifications).toContain('product-inbox-tabs')
    expect(notifications).toContain('product-message-row')
  })

  test('版本页使用原型中的版本轴', () => {
    const source = read('src/app/dashboard/notes/[id]/versions/page.tsx')
    expect(source).toContain('版本记录')
    expect(source).toContain('创建快照')
    expect(source).toContain('product-version-line')
    expect(source).not.toContain('鐗')
  })

  test('知识库、分类和标签沿用原型工作区结构', () => {
    const knowledgeBases = read('src/app/dashboard/knowledge-bases/page.tsx')
    const categories = read('src/app/dashboard/categories/page.tsx')
    const tags = read('src/app/dashboard/tags/page.tsx')
    expect(knowledgeBases).toContain('product-kb-layout')
    expect(categories).toContain('product-category-layout')
    expect(categories).not.toContain('<CategoryOverviewPanel')
    expect(tags).toContain('product-tag-grid')
    expect(tags).toContain('product-merge-bar')
  })
})
