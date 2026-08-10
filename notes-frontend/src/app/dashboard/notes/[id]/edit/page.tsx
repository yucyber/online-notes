import { redirect } from 'next/navigation'

/** Legacy bookmark: /edit → single editor entry at /dashboard/notes/[id] */
export default async function EditNoteRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp || {})) {
    if (typeof value === 'string') qs.set(key, value)
    else if (Array.isArray(value)) value.forEach((v) => qs.append(key, v))
  }
  const suffix = qs.toString()
  redirect(`/dashboard/notes/${id}${suffix ? `?${suffix}` : ''}`)
}
