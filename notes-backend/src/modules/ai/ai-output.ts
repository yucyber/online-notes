/** Shared AI output helpers: fence stripping and JSON extraction. */

export function stripCodeFence(answer: string): string {
  return String(answer || '')
    .replace(/^```(?:json|mermaid)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export function extractJsonObject(answer: string): string | null {
  const text = stripCodeFence(answer).trim()
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return text.slice(firstBrace, lastBrace + 1)
}

export function parseJsonObject(answer: string): any {
  const json = extractJsonObject(answer)
  if (!json) throw new Error('AI output is not JSON.')
  return JSON.parse(json)
}
