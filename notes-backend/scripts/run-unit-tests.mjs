import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const testDir = join(rootDir, 'test')

function collectTests(dir) {
  const entries = readdirSync(dir)
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) return collectTests(fullPath)
    return entry.endsWith('.test.ts') ? [fullPath] : []
  })
}

const testFiles = collectTests(testDir)
if (testFiles.length === 0) {
  console.error('No .test.ts files found under test/')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [
    '--require',
    'ts-node/register',
    '--require',
    'tsconfig-paths/register',
    '--test',
    ...testFiles,
  ],
  { cwd: rootDir, stdio: 'inherit' },
)

process.exit(result.status ?? 1)
