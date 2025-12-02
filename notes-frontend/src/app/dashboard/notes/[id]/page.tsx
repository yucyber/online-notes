'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { deleteNote, fetchNoteById, updateNote } from '@/lib/api'
import MarkdownEditor from '@/components/editor/MarkdownEditor'
import SmartRecommendations from '@/components/SmartRecommendations'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Trash2 } from 'lucide-react'
import type { Note } from '@/types'

export default function NoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => {
    if (id) {
      loadNote()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadNote = async () => {
    try {
      setLoading(true)
      const data = await fetchNoteById(id)
      setNote(data)
      setError('')
    } catch (err) {
      setError('加载笔记失败')
      console.error('Failed to load note:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (title: string, content: string) => {
    try {
      const updatedNote = await updateNote(id, {
        title: title.trim(),
        content: content.trim(),
      })
      setNote(updatedNote)
    } catch (error) {
      console.error('Failed to update note:', error)
      throw new Error('保存失败，请重试')
    }
  }

  const handleSaveDraft = async (title: string, content: string) => {
    try {
      const updatedNote = await updateNote(id, {
        title: title.trim(),
        content: content.trim(),
        status: 'draft',
      })
      setNote(updatedNote)
    } catch (error) {
      console.error('Failed to update draft note:', error)
      throw new Error('保存草稿失败，请重试')
    }
  }

  const handleDelete = async () => {
    try {
      await deleteNote(id)
      setConfirmDeleteOpen(false)
      router.push('/dashboard/notes')
    } catch (error) {
      setError('删除失败，请重试')
      console.error('Failed to delete note:', error)
    }
  }

  const handleBack = () => {
    router.push('/dashboard/notes')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={loadNote}>重试</Button>
      </div>
    )
  }

  if (!note) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">笔记不存在</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1
            className="text-2xl font-bold"
            style={{
              background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {note.title || '笔记详情'}
          </h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setConfirmDeleteOpen(true)}
          className="text-red-500 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div
          className="p-4 text-sm text-red-600"
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          className="bg-white lg:col-span-2"
          style={{
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
          }}
        >
          <MarkdownEditor
            initialContent={note.content || ''}
            initialTitle={note.title || ''}
            onSave={handleSave}
            onSaveDraft={handleSaveDraft}
            isNew={false}
            draftKey={`note:${id}`}
          />
        </div>
        <div>
          <SmartRecommendations currentNoteId={id} />
        </div>
      </div>

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-[92%] max-w-md p-5">
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm text-gray-600 mb-5">确定要删除这条笔记吗？此操作无法撤销。</p>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                onClick={() => setConfirmDeleteOpen(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                onClick={handleDelete}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
