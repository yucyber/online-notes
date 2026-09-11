// 共享依赖解析器：仓库根 scripts/ 下没有 node_modules，
// 统一从 notes-backend/node_modules 与 y-websocket/node_modules 解析依赖。
import { createRequire } from 'node:module'
const backendRequire = createRequire(new URL('../../notes-backend/package.json', import.meta.url))
const ywsRequire = createRequire(new URL('../../y-websocket/package.json', import.meta.url))

export const { MongoClient } = backendRequire('mongodb')
export const Redis = backendRequire('ioredis').default || backendRequire('ioredis')
export const { Queue } = backendRequire('bullmq')
export const jwt = backendRequire('jsonwebtoken')
export const WebSocket = ywsRequire('ws')
export const Y = ywsRequire('yjs')
export const { WebsocketProvider } = ywsRequire('y-websocket')
export const dotenv = backendRequire('dotenv')
export const backendNodeModules = new URL('../../notes-backend/node_modules/', import.meta.url).pathname
