import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SERVER_API_URL } from '@/lib/server/api-url'

const BACKEND_PREFIX = '/assistant'

async function buildHeaders() {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  const cookieStore = await cookies()
  const token = cookieStore.get('notes_token')?.value
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function forward(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }, method: string) {
  const resolved = await context.params
  const segments = Array.isArray(resolved.path) ? resolved.path : []
  const query = new URL(request.url).search
  const target = `${SERVER_API_URL.replace(/\/+$/, '')}${BACKEND_PREFIX}/${segments.join('/')}${query}`
  const init: RequestInit = { method, headers: await buildHeaders(), cache: 'no-store' as RequestCache }
  if (method !== 'GET') {
    const text = await request.text()
    if (text) init.body = text
  }
  const response = await fetch(target, init)
  const contentType = response.headers.get('Content-Type') || ''
  if (contentType.includes('text/event-stream') || contentType.includes('ndjson')) {
    // SSE 与 JSONL 导出原样透传，不能解包信封。
    return new NextResponse(response.body, {
      status: response.status,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  }
  const text = await response.text()
  let payload: any = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { error: text } }
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.message || payload?.error || payload?.data?.message || `Backend assistant request failed with ${response.status}` },
      { status: response.status },
    )
  }
  const data = payload && typeof payload === 'object' && 'code' in payload && 'data' in payload ? payload.data : payload
  return NextResponse.json(data, { status: response.status })
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'GET') }
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'POST') }
export async function PATCH(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'PATCH') }
export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'DELETE') }
