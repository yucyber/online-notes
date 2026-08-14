'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { notesAPI } from '@/lib/api';
import type { NoteFilterParams } from '@/types'
import { Note } from '@/types';

export default function SmartRecommendations({ currentNoteId, context }: { currentNoteId?: string, context?: NoteFilterParams }) {
  const [recommendations, setRecommendations] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('')

  // 展开成原始值，避免 context 对象引用变化触发 effect 重新执行
  const contextKeyword = context?.keyword
  const contextCategoryId = context?.categoryId
  const contextTagIds = JSON.stringify(context?.tagIds)
  const contextTagsMode = context?.tagsMode
  const contextStartDate = context?.startDate
  const contextEndDate = context?.endDate
  const contextStatus = context?.status

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
    // context 是对象，按字段展开成原始值作为依赖，避免对象引用变化导致重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNoteId, contextKeyword, contextCategoryId, contextTagIds, contextTagsMode, contextStartDate, contextEndDate, contextStatus]);

  if (loading) {
    return <div className="animate-pulse h-48 rounded-lg" style={{ background: 'var(--surface-2)' }}></div>;
  }

  if (recommendations.length === 0) {
    return (
      <aside className="prototype-assistant-rail"><section><h3>猜你喜欢</h3>
        {error ? (
          <div className="text-xs rounded p-2 border" style={{ color: 'var(--on-surface)', background: 'var(--surface-2)', borderColor: 'var(--border)' }}>{error}</div>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无推荐内容，稍后再试或新建笔记提升推荐效果。</div>
        )}
      </section></aside>
    );
  }

  const published = recommendations.filter(n => n.status === 'published')
  const drafts = recommendations.filter(n => n.status === 'draft')

  return (
    <aside className="prototype-assistant-rail">
      {published.length > 0 && (
        <>
          <section><h3>猜你喜欢</h3><div>
            {published.map((note, i) => (
              <Link key={`${note.id}:${i}`} href={`/dashboard/notes/${note.id}`} className="block group">
                <div className="prototype-rail-item">
                    <h4>
                      {note.title || '无标题'}
                    </h4>
                  <span>{new Date(note.updatedAt).toLocaleDateString()} 更新</span>
                </div>
              </Link>
            ))}
          </div></section>
        </>
      )}

      <section><h3>继续写作</h3>
        {drafts.length > 0 ? (
          <div>
            {drafts.map((note, i) => (
              <Link key={`${note.id}:${i}`} href={`/dashboard/notes/${note.id}`} className="block group">
                <div className="prototype-rail-item">
                    <h4>
                      {note.title || '未命名草稿'}
                    </h4>
                  <span>草稿 · {new Date(note.updatedAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="prototype-rail-empty">
            暂无草稿，点击上方“新建笔记”或将笔记保存为草稿后，这里会显示待继续的内容。
          </div>
        )}
      </section>
    </aside>
  );
}
