import { proxyStream } from '../_proxy'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return proxyStream('/ai/writer/stream', body)
  } catch (error: any) {
    return Response.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 },
    )
  }
}
