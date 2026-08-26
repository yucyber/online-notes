"use client"
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { mindmapsAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'
import dynamic from 'next/dynamic'
import { useAI } from '@/context/AIContext'
import { getAIMindMapData } from '@/lib/ai-client'
import { appToast } from '@/lib/app-toast'

const MindElixirMap = dynamic(() => import('@/components/mindmap/MindElixirMap'), { ssr: false })

export default function MindmapDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [map, setMap] = useState<{ id: string; title: string; content?: any; noteId: string; noteTitle: string } | null>(null)
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
        const data = await mindmapsAPI.get(id)
        setMap(data)
        setError('')
      } catch (e: any) {
        const status = e.response?.status
        if (status === 404) {
          setError('思维导图不存在')
        } else if (status === 401 || status === 403) {
          setError('无权限访问该思维导图')
        } else {
          setError('加载思维导图失败')
        }
      } finally {
        setLoading(false)
      }
    }
    if (id) load()
  }, [id])

  const handleRename = useCallback(async (value: string) => {
    const title = value.trim()
    if (!title) {
      appToast.error({ id: 'mindmap:rename', title: '名称不能为空' })
      throw new Error('Mindmap title is required')
    }
    try {
      const updated = await mindmapsAPI.update(id, { title })
      setMap((current) => current ? { ...current, title: updated?.title || title } : current)
      appToast.success({ id: 'mindmap:rename', title: '名称已更新' })
    } catch (error) {
      appToast.error({ id: 'mindmap:rename', title: '重命名失败', message: '请稍后重试。' })
      throw error
    }
  }, [id])

  useEffect(() => {
    if (!map?.noteId) return
    // DashboardHeader 位于当前页面外层，通过事件同步业务面包屑，卸载时恢复 URL 默认面包屑。
    const detail = {
      items: [
        { label: '我的笔记', href: '/dashboard/notes' },
        { label: map.noteTitle, href: `/dashboard/notes/${map.noteId}` },
        { label: map.title },
      ],
      onRename: handleRename,
    }
    document.dispatchEvent(new CustomEvent('dashboard:breadcrumbs', { detail }))
    return () => {
      document.dispatchEvent(new CustomEvent('dashboard:breadcrumbs', { detail: null }))
    }
  }, [handleRename, map?.noteId, map?.noteTitle, map?.title])

  const handleBack = () => {
    if (window.opener) {
      window.close()
      return
    }
    router.push(map?.noteId ? `/dashboard/notes/${map.noteId}` : '/dashboard/notes')
  }

  const handleAIGenerate = async () => {
    if (!prompt) return;
    try {
      setIsAILoading(true);
      const data = await getAIMindMapData(prompt);
      setMindMapData(data);
    } catch {
      appToast.error({
        id: 'mindmap:ai-generate',
        title: 'AI 生成失败',
        message: '模型服务暂时不可用，请稍后重试。',
      })
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
      appToast.error({
        id: 'mindmap:insert',
        title: '无法插入到笔记',
        message: '未找到来源页面，请手动复制链接。',
      })
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">加载中…</div>
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!map) return <div className="p-6 text-sm text-gray-500">思维导图不存在</div>

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack}>返回</Button>
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
