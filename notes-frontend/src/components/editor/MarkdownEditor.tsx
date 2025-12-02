'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Save, Eye, Edit, FileText } from 'lucide-react'

interface MarkdownEditorProps {
  initialContent: string
  initialTitle: string
  onSave: (title: string, content: string) => Promise<void>
  onSaveDraft?: (title: string, content: string) => Promise<void>
  isNew?: boolean
  // 本地草稿标识（建议传入笔记 id 或 'new'）
  draftKey?: string
}

export default function MarkdownEditor({
  initialContent,
  initialTitle,
  onSave,
  onSaveDraft,
  isNew = false,
  draftKey,
}: MarkdownEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [title, setTitle] = useState(initialTitle)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [wordCount, setWordCount] = useState(0)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const localSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [restoreBanner, setRestoreBanner] = useState<{ title: string; content: string; updatedAt: number } | null>(null)
  const storageKey = draftKey ? `draft:${draftKey}` : undefined

  // 计算字数
  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(word => word.length > 0)
    setWordCount(words.length)
  }, [content])

  // 使用 useCallback 稳定 handleSave 函数
  const handleSave = useCallback(async (isAutoSave = false) => {
    if (!title.trim()) {
      if (!isAutoSave) {
        alert('请输入笔记标题')
      }
      return
    }

    if (isSaving) return // 防止重复保存

    try {
      setIsSaving(true)
      await onSave(title, content)
      setLastSaved(new Date().toLocaleTimeString('zh-CN'))
      if (!isAutoSave) {
        // 显示保存成功提示
      }
    } catch (error) {
      console.error('保存失败:', error)
      if (!isAutoSave) {
        alert('保存失败，请重试')
      }
    } finally {
      setIsSaving(false)
    }
  }, [title, content, isSaving, onSave])

  // 自动保存（仅编辑模式）- 使用防抖优化性能
  useEffect(() => {
    if (isNew || isSaving) return

    // 检查内容是否有变化
    const hasChanges = content !== initialContent || title !== initialTitle
    if (!hasChanges) return

    // 清除之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // 设置新的定时器（防抖）
    autoSaveTimerRef.current = setTimeout(() => {
      if (title.trim()) {
        handleSave(true).catch(err => {
          console.error('自动保存失败:', err)
        })
      }
    }, 30000) // 30秒自动保存

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [content, title, isNew, isSaving, initialContent, initialTitle, handleSave])

  // 本地草稿：变更后 1s 防抖写入 localStorage
  useEffect(() => {
    if (!storageKey) return
    if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current)
    localSaveTimerRef.current = setTimeout(() => {
      try {
        const payload = {
          title,
          content,
          updatedAt: Date.now(),
        }
        localStorage.setItem(storageKey, JSON.stringify(payload))
      } catch (e) {
        console.warn('保存本地草稿失败', e)
      }
    }, 1000)
    return () => {
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current)
    }
  }, [title, content, storageKey])

  // 启动时检测是否有本地草稿，且与初始值不同则提示恢复
  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as { title: string; content: string; updatedAt: number }
      const isDifferent = (parsed.title !== initialTitle) || (parsed.content !== initialContent)
      if (isDifferent) {
        setRestoreBanner(parsed)
      }
    } catch (e) {
      console.warn('读取本地草稿失败', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // 网络状态监听与自动同步
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // 网络恢复后，如果存在本地草稿且当前内容与草稿一致，立即尝试同步
      try {
        if (storageKey) {
          const raw = localStorage.getItem(storageKey)
          if (raw) {
            const parsed = JSON.parse(raw) as { title: string; content: string }
            const same = (parsed.title === title) && (parsed.content === content)
            if (same && title.trim()) {
              handleSave(true)
                .then(() => {
                  localStorage.removeItem(storageKey)
                })
                .catch(() => {
                  // 保留草稿，稍后重试
                })
            }
          }
        }
      } catch { }
    }
    const handleOffline = () => {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const restoreDraft = async (doSync: boolean) => {
    if (!restoreBanner) return
    setTitle(restoreBanner.title)
    setContent(restoreBanner.content)
    setRestoreBanner(null)
    if (doSync && isOnline) {
      try {
        await handleSave()
        // 成功同步后清理本地草稿
        if (storageKey) localStorage.removeItem(storageKey)
      } catch (e) {
        console.warn('恢复并同步失败，将保留本地草稿以便稍后重试', e)
      }
    }
  }

  // 保存成功后清理本地草稿
  const clearLocalDraftAfterSave = () => {
    try {
      if (storageKey) localStorage.removeItem(storageKey)
    } catch { }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave().then(() => clearLocalDraftAfterSave())
    }
  }

  return (
    <div className="space-y-4">
      {/* 标题和工具栏 */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入笔记标题..."
            className="text-2xl font-bold w-full"
            style={{
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              outline: 'none',
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#3b82f6';
              e.target.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#e5e7eb';
              e.target.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
            }}
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-sm text-gray-500 mr-2">
            {wordCount} 字
          </div>

          {lastSaved && (
            <span className="text-sm text-gray-500 mr-2">
              最后保存: {lastSaved}
            </span>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleSave().then(() => clearLocalDraftAfterSave())}
              disabled={isSaving || !title.trim()}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {isSaving ? '保存中...' : '保存'}
            </Button>
            {onSaveDraft && (
              <Button
                variant="secondary"
                onClick={() => onSaveDraft(title, content)}
                disabled={isSaving || !title.trim()}
              >
                保存为草稿
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 草稿恢复与网络提示 */}
      {restoreBanner && (
        <div
          className="text-sm"
          style={{
            backgroundColor: '#fff7ed',
            border: '1px solid #fdba74',
            borderRadius: '10px',
            padding: '10px 12px',
            color: '#9a3412',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span>
              检测到离线草稿（{new Date(restoreBanner.updatedAt).toLocaleString('zh-CN')}），是否恢复并同步？
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setRestoreBanner(null)}>忽略</Button>
              <Button size="sm" onClick={() => restoreDraft(true)}>恢复并同步</Button>
            </div>
          </div>
          {!isOnline && (
            <div className="mt-2 text-xs text-amber-700">当前离线，将在网络恢复后再尝试同步。</div>
          )}
        </div>
      )}

      {/* 编辑/预览标签页 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('edit')}
            className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'edit'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            <Edit className="h-4 w-4" />
            编辑
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'preview'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            <Eye className="h-4 w-4" />
            预览
          </button>
        </nav>
      </div>

      {/* 编辑区域 */}
      {activeTab === 'edit' && (
        <div className="space-y-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="使用Markdown格式编写笔记...\n\n支持以下语法:\n# 标题\n**粗体**\n*斜体*\n`代码`\n```代码块```\n- 列表项\n[链接](url)\n> 引用"
            className="min-h-[500px] font-mono text-sm resize-none border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex justify-between items-center text-xs text-gray-500">
            <div>
              支持Markdown语法: <code className="bg-gray-100 px-1 rounded"># 标题</code> <code className="bg-gray-100 px-1 rounded">**粗体**</code> <code className="bg-gray-100 px-1 rounded">*斜体*</code> <code className="bg-gray-100 px-1 rounded">`代码`</code> <code className="bg-gray-100 px-1 rounded">```代码块```</code>
            </div>
            <div>
              快捷键: <kbd className="bg-gray-100 px-1 rounded">Ctrl+S</kbd> 保存
            </div>
          </div>
        </div>
      )}

      {/* 预览区域 */}
      {activeTab === 'preview' && (
        <div
          className="min-h-[500px] border border-gray-200 p-6 bg-white"
          style={{
            borderRadius: '12px',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          }}
        >
          {content.trim() ? (
            <div className="prose prose-lg max-w-none">
              <ReactMarkdown
                rehypePlugins={[rehypeSanitize]}
                components={{
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  code({ className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '')
                    const inline = props.inline
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={dracula}
                        language={match[1]}
                        PreTag="div"
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    )
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <FileText className="h-12 w-12 mb-4" />
              <p>预览区域为空</p>
              <p className="text-sm mt-2">切换到编辑标签开始编写内容</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
