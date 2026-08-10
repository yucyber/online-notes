import { getNoteById } from '@/lib/api/server-notes'
import NoteEditorShell from '@/components/editor/NoteEditorShell'
import { notFound, redirect } from 'next/navigation'

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let note = null

  try {
    note = await getNoteById(id)
  } catch (error: any) {
    if (error.message && error.message.includes('401')) {
      redirect('/login')
    }
    throw error
  }

  if (!note) {
    notFound()
  }

  return (
    <NoteEditorShell
      id={id}
      initialData={note}
      initialContent={note.content || ''}
    />
  )
}
