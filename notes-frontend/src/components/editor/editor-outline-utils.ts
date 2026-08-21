export type EditorHeading = { id: string; text: string; level: number }

export function extractEditorHeadings(html: string): EditorHeading[] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading, index) => {
      const level = Number(heading.tagName.substring(1))
      const text = (heading.textContent || '').trim()
      const slug = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '')
      return { id: (heading.id && heading.id.trim()) || `${slug}-${index}`, text, level }
    })
  } catch {
    return []
  }
}

export function sameEditorHeadings(left: EditorHeading[], right: EditorHeading[]) {
  return left.length === right.length && left.every((heading, index) => {
    const candidate = right[index]
    return heading.id === candidate.id && heading.text === candidate.text && heading.level === candidate.level
  })
}
