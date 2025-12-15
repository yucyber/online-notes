"use client"
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getBoard, createBoard } from '@/lib/api'
import { Button } from '@/components/ui/button'
import dynamic from 'next/dynamic'

const DrawnixBoard = dynamic(() => import('@/components/board/DrawnixBoard'), { ssr: false })

export default function BoardDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [board, setBoard] = useState<{ id: string; title: string; content?: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const data = await getBoard(id)
        setBoard(data)
        setError('')
      } catch (e: any) {
        if (e.response?.status === 404) {
          try {
            // 自动创建
            const newBoard = await createBoard({ _id: id, title: '未命名画板' });
            setBoard(newBoard);
            setError('');
          } catch {
            setError('创建画板失败');
          }
        } else {
          setError('加载画板失败')
        }
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
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>返回</Button>
          <h1 className="text-lg font-semibold">{board.title}</h1>
        </div>
      </div>
      <div className="flex-1 bg-gray-50 overflow-hidden">
        <DrawnixBoard id={id} initialData={board.content} />
      </div>
    </div>
  )
}

