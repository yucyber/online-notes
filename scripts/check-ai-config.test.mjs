import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'check-ai-config.mjs')

function runCheck(overrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'online-notes-ai-config-'))
  const backendDir = join(cwd, 'notes-backend')
  mkdirSync(backendDir, { recursive: true })
  const values = {
    SILICONFLOW_API_KEY: 'siliconflow-test-secret',
    SILICONFLOW_BASE_URL: 'https://api.siliconflow.example/v1',
    SILICONFLOW_ECONOMY_TEXT_MODEL: 'Qwen/Qwen3.5-4B',
    SILICONFLOW_STANDARD_TEXT_MODEL: 'Qwen/Qwen3-14B',
    SILICONFLOW_DEEP_REASONING_MODEL: 'deepseek-ai/DeepSeek-V4-Flash',
    SILICONFLOW_EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-8B',
    SILICONFLOW_RERANKER_MODEL: 'Qwen/Qwen3-Reranker-8B',
    BAI_API_KEY: 'bai-test-secret',
    BAI_BASE_URL: 'https://api.bai.example/v1',
    BAI_FALLBACK_MODEL: 'deepseek-v4-flash',
    AR_API_KEY: 'ar-test-secret',
    AR_BASE_URL: 'https://api.agentrouter.example/v1',
    AR_MODEL: 'claude-opus-4-8',
    AI_TEXT_PROVIDER: 'siliconflow',
    AI_REASONING_PROVIDER: 'siliconflow',
    AI_EMBEDDING_PROVIDER: 'siliconflow',
    AI_RERANKER_PROVIDER: 'siliconflow',
    ...overrides,
  }
  writeFileSync(join(backendDir, '.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'))
  const result = spawnSync(process.execPath, [scriptPath], { cwd, encoding: 'utf8', env: {} })
  rmSync(cwd, { recursive: true, force: true })
  return result
}

test('AI 配置检查只报告当前 SiliconFlow、B.AI 和 AR 路由', () => {
  const result = runCheck()

  assert.equal(result.status, 0)
  assert.match(result.stdout, /SILICONFLOW_STANDARD_TEXT_MODEL/)
  assert.match(result.stdout, /SILICONFLOW_DEEP_REASONING_MODEL/)
  assert.match(result.stdout, /BAI_FALLBACK_MODEL/)
  assert.match(result.stdout, /AR_MODEL/)
  assert.doesNotMatch(result.stdout, /SENSENOVA_|MIMO_/i)
  assert.doesNotMatch(result.stdout, /siliconflow-test-secret|bai-test-secret|ar-test-secret/)
})

test('AI 配置检查拒绝已淘汰的默认文本 Provider', () => {
  const result = runCheck({ AI_TEXT_PROVIDER: 'sensenova' })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /AI_TEXT_PROVIDER is "sensenova", expected one of: siliconflow/)
})
