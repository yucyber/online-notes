import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

function getBackendApiUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/+$/, '')
}

async function buildJsonHeaders() {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  const cookieStore = await cookies()
  const token = cookieStore.get('notes_token')?.value
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

function unwrapBackendEnvelope(payload: any) {
  if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
    return payload.data
  }
  return payload
}

function readBackendError(payload: any, fallback: string) {
  if (payload && typeof payload === 'object') {
    return payload.message || payload.error || payload.data?.message || fallback
  }
  return fallback
}

export async function proxyJson(path: string, body: any) {
  const response = await fetch(`${getBackendApiUrl()}${path}`, {
    method: 'POST',
    headers: await buildJsonHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const text = await response.text()
  const payload = text ? safeJsonParse(text) : null

  if (!response.ok) {
    return NextResponse.json(
      { error: readBackendError(payload, `Backend AI request failed with ${response.status}`) },
      { status: response.status },
    )
  }

  return NextResponse.json(unwrapBackendEnvelope(payload), { status: response.status })
}

export async function proxyStream(path: string, body: any) {
  const response = await fetch(`${getBackendApiUrl()}${path}`, {
    method: 'POST',
    headers: await buildJsonHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text()
    const payload = text ? safeJsonParse(text) : null
    return NextResponse.json(
      { error: readBackendError(payload, `Backend AI request failed with ${response.status}`) },
      { status: response.status },
    )
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}
