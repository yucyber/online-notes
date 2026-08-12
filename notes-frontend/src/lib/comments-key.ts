// 生成评论幂等键：用 SHA-1 把可能含冒号/中文的原始输入编码成后端允许的 [a-z0-9]{40}。
// 后端正则 /^[A-Za-z0-9._-]{8,64}$/，直接拼接 noteId:start:end:text 会因冒号与中文而 400。
// TextEncoder 在部分 jest/jsdom 环境不注入全局，故优先用原生实现，缺失时回退到手动 UTF-8 编码。
function utf8Bytes(input: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input)
  }
  const bytes: number[] = []
  for (const ch of input) {
    const code = ch.codePointAt(0) as number
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

export async function buildCommentIdempotencyKey(noteId: string, start: number, end: number, text: string): Promise<string> {
  const raw = `${noteId}:${start}:${end}:${text}`
  const subtle = (globalThis as any).crypto?.subtle
  const digest = await subtle.digest('SHA-1', utf8Bytes(raw))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
