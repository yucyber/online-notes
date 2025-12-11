"use client"
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { boardsAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function BoardDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [board, setBoard] = useState<{ id: string; title: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const data = await boardsAPI.get(id)
        setBoard(data)
        setError('')
      } catch (e: any) {
        setError('加载画板失败')
      } finally {
        setLoading(false)
      }
    }
    if (id) load()
  }, [id])

  if (loading) return <div className="p-6 text-sm text-gray-500">加载中…</div>
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!board) return <div className="p-6 text-sm text-gray-500">画板不存在</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">画板：{board.title}</h1>
        <Button variant="ghost" onClick={() => router.push('/dashboard/notes')}>返回笔记</Button>
      </div>
      <div className="rounded-lg border bg-white p-4">
        <div className="text-sm text-gray-600">资源ID：{board.id}</div>
        <div className="mt-3 text-sm text-gray-600">功能占位：后续可接入白板/图形编辑器。</div>
      </div>
    </div>
  )
}

