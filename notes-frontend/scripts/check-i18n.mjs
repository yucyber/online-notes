import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'src')
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name.startsWith('.')) continue
    try {
      const stat = statSync(p)
      if (stat.isDirectory()) walk(p)
      else if (/(\.(tsx|ts|jsx|js))$/.test(name)) files.push(p)
    } catch { }
  }
}
walk(root)

let errors = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  // 简单规则：阻断 JSX 中的中文硬编码（允许注释与字符串内 ICU tokens）
  const hasChineseLiteral = /<[^>]*?>[\s\S]*?[\u4e00-\u9fa5]+[\s\S]*?<\/[^>]+>/m.test(s)
  if (hasChineseLiteral) {
    console.error(`i18n violation: ${f} 包含 JSX 中文字面量，请使用 t('key') 或传入文案变量`)
    errors++
  }
}

if (errors > 0) {
  console.error(`i18n 检查失败，共 ${errors} 处违规`)
  process.exit(1)
} else {
  console.log('i18n 检查通过')
}
