"use client"
import { useParams, useSearchParams } from 'next/navigation'
import { boardsAPI } from '@/lib/api'
import dynamic from 'next/dynamic'
import { ResourceEmbedPage } from '@/components/embed/ResourceEmbedPage'

const DrawnixBoard = dynamic(() => import('@/components/board/DrawnixBoard'), { ssr: false })

export default function BoardEmbedPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const id = params?.id as string
    const readonly = searchParams.get('readonly') === 'true'

    return (
        <ResourceEmbedPage
            loader={() => boardsAPI.get(id)}
            renderer={(board: { id: string; content?: any }) => (
                <div className="w-full h-screen overflow-hidden bg-white">
                    <DrawnixBoard id={id} initialData={board.content} readonly={readonly} />
                </div>
            )}
            notFoundMessage="未找到内容"
        />
    )
}
