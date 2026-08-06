import { NextResponse } from 'next/server'
import { proxyStream } from '../_proxy'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const message = String(body?.message || '')
    const conversationId = String(body?.conversationId || '')

    if (body?.image) {
      return NextResponse.json(
        { error: 'Image chat is not supported after the AI provider migration. Please send text only for now.' },
        { status: 400 },
      )
    }

    return proxyStream('/ai/pet', { message, conversationId })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 },
    )
  }
}
