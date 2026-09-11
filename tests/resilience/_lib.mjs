// 韧性实验共享工具：依赖解析、真实基础设施连接、断言报告与证据落盘。
// 仓库根没有 node_modules，依赖统一从 notes-backend / y-websocket 解析。
// 本目录只做测量，不引入任何业务逻辑改动。
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as dns from 'node:dns'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '..', '..')
export const BACKEND_ROOT = join(REPO_ROOT, 'notes-backend')
export const RAW_DIR = join(REPO_ROOT, 'docs', 'metrics', 'raw', 'resilience')

const backendRequire = createRequire(join(BACKEND_ROOT, 'package.json'))
const ywsRequire = createRequire(join(REPO_ROOT, 'y-websocket', 'package.json'))

export const mongoose = backendRequire('mongoose')
export const { MongoClient } = backendRequire('mongodb')
export const Redis = backendRequire('ioredis').default || backendRequire('ioredis')
export const jwt = backendRequire('jsonwebtoken')
export const dotenv = backendRequire('dotenv')
export const WebSocket = ywsRequire('ws')

// mongodb+srv 的 SRV 查询在 Windows 下会被 c-ares 拒绝（同 main.ts 的处理）。
export function fixDns() {
  dns.setDefaultResultOrder('ipv4first')
  dns.setServers(['8.8.8.8', '1.1.1.1'])
}

dotenv.config({ path: join(BACKEND_ROOT, '.env') })

// MONGODB_URI 未带库名，驱动默认落到 test（与后端实际使用的库一致）
export const DB = 'test'
export const API = 'http://127.0.0.1:3001/api'

export function env(name, fallback) {
  const value = process.env[name] ?? fallback
  if (value === undefined) throw new Error(`missing env ${name}`)
  return value
}

// 加载后端编译产物（保证测的是真实实现，而不是重写一遍）
export function loadBackendDist(relPath) {
  return backendRequire(join(BACKEND_ROOT, 'dist', relPath))
}

// 用后端的解析上下文加载依赖（rxjs 等由 @nestjs/* 带入，仓库根解析不到）
export function loadBackendDep(name) {
  return backendRequire(name)
}

// y-websocket 服务端依赖（yjs / y-websocket / ws）
export function loadYwsDep(name) {
  return ywsRequire(name)
}

export const YWS_ROOT = join(REPO_ROOT, 'y-websocket')

export function sha1(input) {
  return createHash('sha1').update(String(input)).digest('hex')
}

export function digestOf(values) {
  return sha1([...values].map(String).sort().join('|'))
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function writeRaw(filename, payload) {
  mkdirSync(RAW_DIR, { recursive: true })
  const target = join(RAW_DIR, filename)
  writeFileSync(target, JSON.stringify(payload, null, 2))
  return target
}

// 断言收集器：控制台逐条打印 PASS/FAIL，同时把全部明细写进 JSON 证据。
export function createReport(title, meta = {}) {
  const assertions = []
  const report = {
    title,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    ...meta,
    assertions,
  }
  report.check = (name, pass, detail) => {
    const ok = Boolean(pass)
    assertions.push({ name, pass: ok, ...(detail === undefined ? {} : { detail }) })
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  :: ${JSON.stringify(detail)}`}\n`)
    return ok
  }
  report.finish = (filename) => {
    report.summary = {
      total: assertions.length,
      passed: assertions.filter((a) => a.pass).length,
      failed: assertions.filter((a) => !a.pass).length,
    }
    report.finishedAt = new Date().toISOString()
    const path = filename ? writeRaw(filename, report) : null
    process.stdout.write(`\n== ${title}: ${report.summary.passed}/${report.summary.total} passed${report.summary.failed ? ` (${report.summary.failed} FAILED)` : ''} ==\n`)
    if (path) process.stdout.write(`raw evidence -> ${path.replace(REPO_ROOT, '.')}\n`)
    return report
  }
  return report
}

// 用后端 JWT_SECRET 为真实用户签发访问令牌（仅本地测量用）
export async function pickUserAndToken(email) {
  const client = await MongoClient.connect(env('MONGODB_URI'), { serverSelectionTimeoutMS: 20000 })
  const users = client.db(DB).collection('users')
  const user = email ? await users.findOne({ email }) : await users.findOne({})
  if (!user) {
    await client.close()
    throw new Error('no user found in db')
  }
  const token = jwt.sign({ email: user.email, sub: String(user._id) }, env('JWT_SECRET'), { expiresIn: '2h' })
  return { user, token, client, close: () => client.close() }
}

export async function httpJson(url, options = {}) {
  const res = await fetch(url, options)
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, headers: res.headers, body }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
