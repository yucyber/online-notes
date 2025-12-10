'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Lightbulb, Clock, PencilLine } from 'lucide-react';
import { truncateText } from '@/utils'
import { notesAPI } from '@/lib/api';
import type { NoteFilterParams } from '@/types'
import { Note } from '@/types';

export default function SmartRecommendations({ currentNoteId, context }: { currentNoteId?: string, context?: NoteFilterParams }) {
  const [recommendations, setRecommendations] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        const data = await notesAPI.getRecommendations(currentNoteId, 5, context);
        setRecommendations(data);
        setError('')
      } catch (error) {
        const anyErr = error as any
        const status = anyErr?.response?.status
        if (status === 400 || status === 422) {
          try {
            const data = await notesAPI.getRecommendations(currentNoteId, 5)
            setRecommendations(data)
            setError('')
            return
          } catch (e) {
            console.warn('Fallback recommendations failed', e)
            try {
              const all = await notesAPI.getAll()
              const list: Note[] = Array.isArray(all) ? all : (all?.items || [])
              const published = list.filter((n: Note) => n.status === 'published').slice(0, 5)
              const drafts = list.filter((n: Note) => n.status === 'draft').slice(0, 2)
              const merged = [...published, ...drafts]
              if (merged.length > 0) {
                setRecommendations(merged)
                setError('')
                return
              }
            } catch (e2) {
              console.warn('Secondary fallback failed', e2)
            }
          }
        }
        if (status === 401) {
          setError('登录状态失效，请重新登录')
        } else if (!anyErr?.response && String(anyErr?.message || '').toLowerCase().includes('network')) {
          setError('网络异常，正在重试…')
          setTimeout(() => {
            setLoading(true)
            notesAPI.getRecommendations(currentNoteId, 5, context).then(d => {
              setRecommendations(d)
              setError('')
            }).catch(() => {
              setError('网络异常，稍后再试')
            }).finally(() => setLoading(false))
          }, 2000)
        } else {
          setError('推荐服务暂不可用')
        }
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [currentNoteId, context?.keyword, context?.categoryId, JSON.stringify(context?.tagIds), context?.tagsMode, context?.startDate, context?.endDate, context?.status]);

  if (loading) {
    return <div className="animate-pulse bg-gray-100 h-48 rounded-lg"></div>;
  }

  if (recommendations.length === 0) {
    return (
      <div className="bg-white p-4 rounded-lg shadow h-fit">
        <div className="flex items-center gap-2 mb-2 text-blue-600">
          <Lightbulb className="h-5 w-5" />
          <h3 className="font-medium">猜你想看</h3>
        </div>
        {error ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
        ) : (
          <div className="text-xs text-gray-500">暂无推荐内容，稍后再试或新建笔记提升推荐效果。</div>
        )}
      </div>
    );
  }

  const published = recommendations.filter(n => n.status === 'published')
  const drafts = recommendations.filter(n => n.status === 'draft')

  return (
    <div className="bg-white p-4 rounded-lg shadow h-fit">
      {published.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3 text-blue-600">
            <Lightbulb className="h-5 w-5" />
            <h3 className="font-medium">猜你想看</h3>
          </div>
          <div className="space-y-3 mb-4">
            {published.map((note, i) => (
              <Link key={`${note.id}:${i}`} href={`/dashboard/notes/${note.id}`} className="block group">
                <div className="p-3 rounded-md hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200">
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium text-gray-800 group-hover:text-blue-600 text-sm line-clamp-1">
                      {note.title || '无标题'}
                    </h4>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                    {truncateText(String(note.content || '').replace(/[#*`_~>\[\]()]/g, ''), 90)}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="mt-2">
        <div className="flex items-center gap-2 mb-3 text-yellow-700">
          <PencilLine className="h-5 w-5" />
          <h3 className="font-medium">继续写作</h3>
        </div>
        {drafts.length > 0 ? (
          <div className="space-y-3">
            {drafts.map((note, i) => (
              <Link key={`${note.id}:${i}`} href={`/dashboard/notes/${note.id}`} className="block group">
                <div className="p-3 rounded-md hover:bg-yellow-50 transition-colors border border-transparent hover:border-yellow-200">
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium text-gray-800 group-hover:text-yellow-700 text-sm line-clamp-1">
                      {note.title || '未命名草稿'}
                    </h4>
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">草稿</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                    {truncateText(String(note.content || '').replace(/[#*`_~>\[\]()]/g, ''), 90)}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 bg-yellow-50/40 border border-yellow-100 rounded p-3">
            暂无草稿，点击上方“新建笔记”或将笔记保存为草稿后，这里会显示待继续的内容。
          </div>
        )}
      </div>
    </div>
  );
}
