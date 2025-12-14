"use client"
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { getBoard } from '@/lib/api'
import dynamic from 'next/dynamic'

const DrawnixBoard = dynamic(() => import('@/components/board/DrawnixBoard'), { ssr: false })

export default function BoardEmbedPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const id = params?.id as string
    const readonly = searchParams.get('readonly') === 'true'

    const [board, setBoard] = useState<{ id: string; content?: any } | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true)
                const data = await getBoard(id)
                setBoard(data)
                setError('')
            } catch (e) {
                setError('加载失败')
            } finally {
                setLoading(false)
            }
        }
        if (id) load()
    }, [id])

    if (loading) return <div className="flex items-center justify-center h-screen text-gray-500 text-sm">加载中...</div>
    if (error) return <div className="flex items-center justify-center h-screen text-red-500 text-sm">{error}</div>
    if (!board) return <div className="flex items-center justify-center h-screen text-gray-500 text-sm">未找到内容</div>

    return (
        <div className="w-full h-screen overflow-hidden bg-white">
            <DrawnixBoard id={id} initialData={board.content} readonly={readonly} />
        </div>
    )
}
