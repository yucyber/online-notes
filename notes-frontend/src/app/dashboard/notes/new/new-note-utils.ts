export function mergeTagIds(selectedIds: string[], generatedIds: string[]): string[] {
  return Array.from(new Set([...selectedIds, ...generatedIds].filter(Boolean)))
}
