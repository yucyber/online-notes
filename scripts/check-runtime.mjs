import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function checkRuntime({ nodeVersion, rootFiles }) {
  const errors = []
  const major = Number(String(nodeVersion || '').split('.')[0])
  if (major !== 22) {
    errors.push(`需要 Node.js 22.x，当前为 ${nodeVersion || 'unknown'}。请先执行 nvm use 22。`)
  }
  if (!rootFiles.includes('package-lock.json')) {
    errors.push('缺少根 package-lock.json。请使用 npm install 生成并提交 npm lockfile。')
  }
  const pnpmLock = rootFiles.find(file => file.endsWith('pnpm-lock.yaml'))
  if (pnpmLock) {
    errors.push(`检测到 ${pnpmLock}。本仓库只允许 npm，请移除该 pnpm-lock.yaml。`)
  }
  return { ok: errors.length === 0, errors }
}

function inspectWorkspace(rootDir) {
  const candidates = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'notes-backend/pnpm-lock.yaml',
    'notes-frontend/pnpm-lock.yaml',
  ]
  return candidates.filter(file => existsSync(path.join(rootDir, file)))
}

function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = checkRuntime({
    nodeVersion: process.versions.node,
    rootFiles: inspectWorkspace(rootDir),
  })
  if (!result.ok) {
    result.errors.forEach(error => console.error(`- ${error}`))
    process.exitCode = 1
    return
  }
  console.log(`运行时检查通过：Node.js ${process.versions.node}，包管理器 npm。`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
