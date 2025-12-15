import { getNoteById } from '@/lib/api/server-notes'
import NoteClientWrapper from './NoteClientWrapper'
import { notFound, redirect } from 'next/navigation'

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let note = null

  try {
    note = await getNoteById(id)
  } catch (error: any) {
    // Handle 401 Unauthorized by redirecting to login
    if (error.message && error.message.includes('401')) {
      redirect('/login')
    }
    throw error
  }

  if (!note) {
    notFound()
  }

  return (
    <NoteClientWrapper
      id={id}
      initialData={note}
      initialContent={note.content || ''}
    />
  )
}
