"use client"
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getMindMap, createMindMap } from '@/lib/api'
import { Button } from '@/components/ui/button'
import dynamic from 'next/dynamic'
import { useAI } from '@/context/AIContext'
import { getAIMindMapData } from '@/lib/coze'

const MindElixirMap = dynamic(() => import('@/components/mindmap/MindElixirMap'), { ssr: false })

export default function MindmapDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [map, setMap] = useState<{ id: string; title: string; content?: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { setMindMapData, setIsAILoading, isAILoading } = useAI()
  const [prompt, setPrompt] = useState('')
  const [hasOpener, setHasOpener] = useState(false)

  useEffect(() => {
    setHasOpener(!!window.opener)
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const data = await getMindMap(id)
        setMap(data)
        setError('')
      } catch (e: any) {
        if (e.response?.status === 404) {
          try {
            // 自动创建
            const newMap = await createMindMap({ _id: id, title: '未命名思维导图' });
            setMap(newMap);
            setError('');
          } catch {
            setError('创建思维导图失败');
          }
        } else {
          setError('加载思维导图失败')
        }
      } finally {
        setLoading(false)
      }
    }
    if (id) load()
  }, [id])

  const handleAIGenerate = async () => {
    if (!prompt) return;
    try {
      setIsAILoading(true);
      const data = await getAIMindMapData(prompt);
      setMindMapData(data);
    } catch (e) {
      alert('AI 生成失败，请检查配置或重试');
    } finally {
      setIsAILoading(false);
    }
  };

  const handleInsertToNote = () => {
    if (window.opener) {
      window.opener.postMessage({
        type: 'INSERT_MINDMAP',
        payload: {
          id: map?.id,
          title: map?.title
        }
      }, '*')
      // Optional: window.close()
    } else {
      alert('无法找到来源页面，请手动复制链接')
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">加载中…</div>
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!map) return <div className="p-6 text-sm text-gray-500">思维导图不存在</div>

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>返回</Button>
          <h1 className="text-lg font-semibold">{map.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {hasOpener && (
            <Button variant="outline" size="sm" onClick={handleInsertToNote}>
              插入到笔记
            </Button>
          )}
          <input
            type="text"
            placeholder="输入主题让 AI 生成..."
            className="border rounded px-2 py-1 text-sm w-64"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button
            onClick={handleAIGenerate}
            disabled={isAILoading}
            size="sm"
          >
            {isAILoading ? '生成中...' : 'AI 生成'}
          </Button>
        </div>
      </div>
      <div className="flex-1 bg-gray-50 overflow-hidden">
        <MindElixirMap id={id} initialData={map.content} />
      </div>
    </div>
  )
}
