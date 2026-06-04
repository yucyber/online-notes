import { NextResponse } from 'next/server'
import { proxyStream } from '../_proxy'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const message = String(formData.get('message') || '')
    const conversationId = String(formData.get('conversationId') || '')
    const image = formData.get('image') as File | null

    if (image && image.size > 0) {
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
