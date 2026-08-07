"use client"
import { useParams, useSearchParams } from 'next/navigation'
import { mindmapsAPI } from '@/lib/api'
import dynamic from 'next/dynamic'
import { ResourceEmbedPage } from '@/components/embed/ResourceEmbedPage'

const MindElixirMap = dynamic(() => import('@/components/mindmap/MindElixirMap'), { ssr: false })

export default function MindmapEmbedPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const id = params?.id as string
    const readonly = searchParams.get('readonly') === 'true'

    return (
        <ResourceEmbedPage
            loader={() => mindmapsAPI.get(id)}
            renderer={(map: { id: string; title: string; content?: any }) => (
                <div className="w-full h-screen overflow-hidden bg-white">
                    <MindElixirMap id={id} initialData={map.content} readonly={readonly} />
                </div>
            )}
            notFoundMessage="未找到内容"
        />
    )
}
