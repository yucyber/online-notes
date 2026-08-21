import type { Tag } from '@/types'

function uniqueTagNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => name.trim()).filter((name) => {
    if (!name) return false
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseTagNames(input: string): string[] {
  return uniqueTagNames(input.split(/[,，\s]+/))
}

export async function resolveTagIdsByNames(
  names: string[],
  tags: Tag[],
  create: (name: string) => Promise<Tag | null>,
): Promise<{ ids: string[]; created: Tag[] }> {
  const tagsByName = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]))
  const ids: string[] = []
  const created: Tag[] = []

  for (const name of uniqueTagNames(names)) {
    const existing = tagsByName.get(name.toLowerCase())
    if (existing) {
      if (existing.id) ids.push(existing.id)
      continue
    }

    const tag = await create(name)
    if (!tag?.id) continue
    ids.push(tag.id)
    created.push(tag)
    tagsByName.set(name.toLowerCase(), tag)
  }

  return { ids, created }
}
