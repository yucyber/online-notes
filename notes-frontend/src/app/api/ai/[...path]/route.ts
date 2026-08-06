import { NextResponse } from 'next/server'
import { proxyJson, proxyStream } from '../_proxy'

const STREAM_PATHS = new Set(['writer', 'pet'])
const JSON_PATHS = new Set(['mindmap', 'mermaid', 'summary'])

function resolveBackendPath(segments: string[]): { path: string; mode: 'json' | 'stream' } | null {
  if (segments.length !== 1) return null
  const name = segments[0]
  if (STREAM_PATHS.has(name)) {
    return {
      path: name === 'writer' ? '/ai/writer/stream' : `/ai/${name}`,
      mode: 'stream',
    }
  }
  if (JSON_PATHS.has(name)) {
    return { path: `/ai/${name}`, mode: 'json' }
  }
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> | { path: string[] } },
) {
  try {
    const resolved = await context.params
    const segments = Array.isArray(resolved.path) ? resolved.path : []
    const target = resolveBackendPath(segments)
    if (!target) {
      return NextResponse.json({ error: `Unknown AI route: ${segments.join('/')}` }, { status: 404 })
    }

    const body = await request.json()
    if (segments[0] === 'pet' && body?.image) {
      return NextResponse.json(
        { error: 'Image chat is not supported after the AI provider migration. Please send text only for now.' },
        { status: 400 },
      )
    }

    return target.mode === 'stream'
      ? proxyStream(target.path, body)
      : proxyJson(target.path, body)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 },
    )
  }
}
