/** Shared pure helpers for knowledge graph proposals and persistence. */

export type KnowledgeGraphNodeType = 'concept' | 'entity' | 'topic' | 'claim'

export function normalizeKnowledgeGraphNodeType(value: unknown): KnowledgeGraphNodeType {
  const type = String(value || '').trim().toLowerCase()
  return type === 'entity' || type === 'topic' || type === 'claim' ? type : 'concept'
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

export function normalizeKnowledgeGraphNoteIds(noteIds: unknown, allowedNoteIds: Set<string>): string[] {
  return uniqueStrings(
    (Array.isArray(noteIds) ? noteIds : [])
      .map((noteId) => String(noteId || '').trim())
      .filter((noteId) => allowedNoteIds.has(noteId)),
  )
}

/** Prefer explicit noteIds in the allowed set; otherwise fall back to related node noteIds. */
export function resolveKnowledgeGraphEdgeNoteIds(
  explicitNoteIds: unknown,
  allowedNoteIds: Set<string>,
  fallbackNoteIds: string[],
): string[] {
  const explicit = normalizeKnowledgeGraphNoteIds(explicitNoteIds, allowedNoteIds)
  if (explicit.length > 0) return explicit
  return uniqueStrings(fallbackNoteIds.filter((noteId) => allowedNoteIds.has(noteId)))
}

export function clampUnitInterval(value: unknown, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(1, numeric))
}
