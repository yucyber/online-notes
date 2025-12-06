#!/usr/bin/env node
/**
 * CI 断言关键用例存在：片段过滤/搜索 & 权限（登录/访问控制）
 * 若缺失则退出非零码，阻断合并。
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const testsDir = join(root, '__tests__')

function listFiles(dir) {
  try {
    const entries = readdirSync(dir)
    const files = []
    for (const e of entries) {
      const full = join(dir, e)
      const st = statSync(full)
      if (st.isDirectory()) files.push(...listFiles(full))
      else files.push(full)
    }
    return files
  } catch (e) {
    return []
  }
}

const files = listFiles(testsDir)

const hasFilter = files.some(f => /search|filter|fragment/i.test(f))
const hasAuth = files.some(f => /auth|login|permission|rbac|权限/i.test(f))

const missing = []
if (!hasFilter) missing.push('片段过滤/搜索测试')
if (!hasAuth) missing.push('权限/RBAC测试')

if (missing.length) {
  console.error(`CI阻断：缺失用例 -> ${missing.join('，')}`)
  process.exit(2)
} else {
  console.log('CI校验通过：已检测到片段过滤与权限相关测试文件')
}

