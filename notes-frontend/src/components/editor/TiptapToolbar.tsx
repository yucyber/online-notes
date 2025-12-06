"use client"
import { Button } from '@/components/ui/button'
import { Bold, Italic, Underline, ListOrdered, List, Heading, Quote, Code, Undo2, Redo2, Save, Link as LinkIcon, Unlink, Image as ImageIcon, AlignLeft, AlignCenter, AlignRight, Highlighter, Superscript, Subscript, ListChecks, Table, MessageSquare, Maximize, Minimize } from 'lucide-react'

type Props = {
  disabled?: boolean
  exec: (cmd: string, payload?: any) => void
  isFullscreen?: boolean
}

export default function TiptapToolbar({ disabled, exec, isFullscreen }: Props) {
  const fileInputId = 'editor-image-input'
  return (
    <div
      role="toolbar"
      aria-label="编辑器工具栏"
      className="flex items-center gap-2 justify-start overflow-x-auto"
      style={{ height: 44, paddingLeft: 0, paddingRight: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflowX: 'auto', overscrollBehaviorX: 'contain' }}
    >
      {/* 基本文本样式 - 图标化 */}
      <Button size="icon" variant="ghost" aria-label="粗体" title="粗体 (Ctrl+B)" disabled={disabled} onClick={() => exec('bold')}><Bold className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="斜体" title="斜体 (Ctrl+I)" disabled={disabled} onClick={() => exec('italic')}><Italic className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="下划线" title="下划线 (Ctrl+U)" disabled={disabled} onClick={() => exec('underline')}><Underline className="w-4 h-4" aria-hidden /></Button>
      <div aria-hidden className="w-px h-4 bg-gray-200 mx-1" />
      <Button size="icon" variant="ghost" aria-label="标题二级" title="标题 (H2)" disabled={disabled} onClick={() => exec('heading', { level: 2 })}><Heading className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="有序列表" title="有序列表" disabled={disabled} onClick={() => exec('ol')}><ListOrdered className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="无序列表" title="无序列表" disabled={disabled} onClick={() => exec('ul')}><List className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="任务清单" title="任务清单" disabled={disabled} onClick={() => exec('task')}><ListChecks className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="引用" title="引用" disabled={disabled} onClick={() => exec('blockquote')}><Quote className="w-4 h-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label="代码" title="行内代码" disabled={disabled} onClick={() => exec('code')}><Code className="w-4 h-4" aria-hidden /></Button>
      <div aria-hidden className="w-px h-4 bg-gray-200 mx-1" />
      {/* 链接/图片/表格 */}
      <Button size="icon" variant="ghost" aria-label="插入链接" title="插入链接 (Ctrl+K)" disabled={disabled} onClick={() => { const href = window.prompt('输入链接地址') || ''; if (href.trim()) exec('link', { href: href.trim() }) }}><LinkIcon className="w-4 h-4" aria-hidden/></Button>
      <Button size="icon" variant="ghost" aria-label="取消链接" title="取消链接" disabled={disabled} onClick={()=>exec('unlink')}><Unlink className="w-4 h-4" aria-hidden/></Button>
      <input id={fileInputId} type="file" accept="image/*" className="sr-only" onChange={async (e)=>{ const f = e.target.files?.[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => { const src = String(reader.result||''); exec('image', { src }) }; reader.readAsDataURL(f); e.currentTarget.value = '' }} />
      <Button size="icon" variant="ghost" aria-label="插入图片" title="插入图片" disabled={disabled} onClick={()=>{ const el = document.getElementById(fileInputId) as HTMLInputElement|null; el?.click() }}><ImageIcon className="w-4 h-4" aria-hidden/></Button>
      <Button size="icon" variant="ghost" aria-label="插入表格" title="插入表格 3x3" disabled={disabled} onClick={()=>exec('table')}><Table className="w-4 h-4" aria-hidden/></Button>
      <div className="flex items-center gap-2">
        {/* 对齐/高亮/上下标/分隔线 */}
        <Button size="icon" variant="ghost" aria-label="左对齐" title="左对齐" onClick={()=>exec('align',{align:'left'})}><AlignLeft className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="居中" title="居中" onClick={()=>exec('align',{align:'center'})}><AlignCenter className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="右对齐" title="右对齐" onClick={()=>exec('align',{align:'right'})}><AlignRight className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="高亮" title="高亮" onClick={()=>exec('highlight')}><Highlighter className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="上标" title="上标" onClick={()=>exec('sup')}><Superscript className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="下标" title="下标" onClick={()=>exec('sub')}><Subscript className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="插入分隔线" title="插入分隔线" onClick={()=>exec('hr')}><Highlighter className="w-4 h-4" aria-hidden/></Button>
        <input type="color" aria-label="文字颜色" title="文字颜色" onChange={(e)=>exec('color',{color:e.target.value})} style={{ width: 28, height: 28, border: '1px solid #e5e7eb', borderRadius: 6 }} />
        {/* 撤销/重做/保存 */}
        <Button size="icon" variant="ghost" aria-label="撤销" title="撤销 (Ctrl+Z)" onClick={()=>exec('undo')}><Undo2 className="w-4 h-4" aria-hidden/></Button>
        <Button size="icon" variant="ghost" aria-label="重做" title="重做 (Ctrl+Y)" onClick={()=>exec('redo')}><Redo2 className="w-4 h-4" aria-hidden/></Button>
        <Button id="save-button" size="icon" aria-label="保存" title="保存 (Ctrl+S)" onClick={()=>exec('save')}><Save className="w-4 h-4" aria-hidden/></Button>
        {/* 评论按钮（打开评论弹窗） */}
        <Button size="icon" variant="ghost" aria-label="打开评论" title="打开评论 (Alt+C)" onClick={()=>exec('comments')}>
          <MessageSquare className="w-4 h-4" aria-hidden />
        </Button>
        {/* 全屏切换 */}
        <Button id="fullscreen-button" size="icon" variant="ghost" aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title="切换全屏 (Ctrl+Shift+F)" aria-pressed={Boolean(isFullscreen)} onClick={()=>exec('fullscreen')}>
          {isFullscreen ? <Minimize className="w-4 h-4" aria-hidden /> : <Maximize className="w-4 h-4" aria-hidden />}
        </Button>
      </div>
    </div>
  )
}
