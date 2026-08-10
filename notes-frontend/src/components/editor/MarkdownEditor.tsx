'use client'

import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Edit, Eye, FileText, Save } from 'lucide-react'
import { useMarkdownEditor } from './useMarkdownEditor'

interface MarkdownEditorProps {
  initialContent: string
  initialTitle: string
  onSave: (title: string, content: string) => Promise<void>
  onSaveDraft?: (title: string, content: string) => Promise<void>
  isNew?: boolean
  draftKey?: string
  onSelectionChange?: (start: number, end: number) => void
  onContentChange?: (content: string, title: string) => void
}

export default function MarkdownEditor({ initialContent, initialTitle, onSave, onSaveDraft, isNew = false, draftKey, onSelectionChange, onContentChange }: MarkdownEditorProps) {
  const editor = useMarkdownEditor({ initialContent, initialTitle, onSave, isNew, draftKey, onContentChange })
  return <div className="space-y-4">
    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between sticky top-0 z-30 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 py-2"><div className="flex-1 min-w-0"><input type="text" value={editor.title} onChange={(event) => editor.setTitle(event.target.value)} placeholder="请输入笔记标题..." className="text-2xl font-bold w-full" style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '12px', outline: 'none', transition: 'all 0.2s ease', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }} /></div><div className="flex items-center gap-2 flex-shrink-0"><div className="text-sm text-gray-500 mr-2">{editor.wordCount} 字</div>{editor.lastSaved && <span className="text-sm text-gray-500 mr-2">最后保存: {editor.lastSaved}</span>}<div className="flex items-center gap-2"><Button id="save-button" onClick={() => void editor.handleSave().then(editor.clearLocalDraftAfterSave)} disabled={editor.isSaving || !editor.title.trim()} className="flex items-center gap-2"><Save className="h-4 w-4" />{editor.isSaving ? '保存中...' : '保存'}</Button>{onSaveDraft && <Button variant="secondary" onClick={() => void onSaveDraft(editor.title, editor.content)} disabled={editor.isSaving || !editor.title.trim()}>保存为草稿</Button>}</div></div></div>
    {editor.restoreBanner && <div className="text-sm" style={{ backgroundColor: '#fff7ed', border: '1px solid #fdba74', borderRadius: '10px', padding: '10px 12px', color: '#9a3412' }}><div className="flex items-center justify-between gap-3"><span>检测到离线草稿（{new Date(editor.restoreBanner.updatedAt).toLocaleString('zh-CN')}），是否恢复并同步？</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => editor.setRestoreBanner(null)}>忽略</Button><Button size="sm" onClick={() => void editor.restoreDraft(true)}>恢复并同步</Button></div></div>{!editor.isOnline && <div className="mt-2 text-xs text-amber-700">当前离线，将在网络恢复后再尝试同步。</div>}</div>}
    <div className="border-b border-gray-200"><nav className="-mb-px flex space-x-8"><button id="edit-toggle" onClick={() => editor.setActiveTab('edit')} className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${editor.activeTab === 'edit' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><Edit className="h-4 w-4" />编辑</button><button id="preview-toggle" onClick={() => editor.setActiveTab('preview')} className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${editor.activeTab === 'preview' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><Eye className="h-4 w-4" />预览</button></nav></div>
    {editor.activeTab === 'edit' && <div className="space-y-2"><Textarea value={editor.content} onChange={(event) => editor.setContent(event.target.value)} onKeyDown={editor.handleKeyDown} onSelect={(event) => notifySelection(event, onSelectionChange)} onMouseUp={(event) => notifySelection(event, onSelectionChange)} onKeyUp={(event) => notifySelection(event, onSelectionChange)} placeholder={'使用Markdown格式编写笔记...\n\n支持以下语法:\n# 标题\n**粗体**\n*斜体*\n`代码`\n```代码块```\n- 列表项\n[链接](url)\n> 引用'} className="min-h-[560px] h-[60vh] md:min-h-[640px] md:h-[70vh] font-mono text-sm resize-none border border-[#e8e8e8] rounded-[2px] p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent" /><div className="flex justify-between items-center text-xs text-gray-500"><div>支持Markdown语法: <code className="bg-gray-100 px-1 rounded"># 标题</code> <code className="bg-gray-100 px-1 rounded">**粗体**</code> <code className="bg-gray-100 px-1 rounded">*斜体*</code> <code className="bg-gray-100 px-1 rounded">`代码`</code> <code className="bg-gray-100 px-1 rounded">```代码块```</code></div><div>快捷键: <kbd className="bg-gray-100 px-1 rounded">Ctrl+S</kbd> 保存</div></div></div>}
    {editor.activeTab === 'preview' && <div className="min-h-[560px] h-[60vh] md:min-h-[640px] md:h-[70vh] border border-gray-200 p-6 bg-white overflow-y-auto" style={{ borderRadius: '12px', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>{editor.content.trim() ? <div className="prose prose-lg max-w-none"><ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={{ code({ className, children, ...props }: any) { const match = /language-(\w+)/.exec(className || ''); const inline = props.inline; return !inline && match ? <SyntaxHighlighter style={dracula} language={match[1]} PreTag="div" {...props}>{String(children).replace(/\n$/, '')}</SyntaxHighlighter> : <code className={className} {...props}>{children}</code> } }}>{editor.content}</ReactMarkdown></div> : <div className="flex flex-col items-center justify-center h-64 text-gray-500"><FileText className="h-12 w-12 mb-4" /><p>预览区域为空</p><p className="text-sm mt-2">切换到编辑标签开始编写内容</p></div>}</div>}
  </div>
}

function notifySelection(event: React.SyntheticEvent<HTMLTextAreaElement>, callback?: (start: number, end: number) => void) {
  if (!callback) return
  const target = event.currentTarget
  callback(target.selectionStart || 0, target.selectionEnd || 0)
}
