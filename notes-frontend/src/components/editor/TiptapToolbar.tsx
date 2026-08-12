"use client"
import { Button } from '@/components/ui/button'
import { AlignCenter, AlignLeft, AlignRight, Bold, Code, Heading, Highlighter, Image as ImageIcon, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Maximize, MessageSquare, Minimize, Plus, Quote, Redo2, Save, Subscript, Superscript, Table, Underline, Undo2, Unlink, Users } from 'lucide-react'

type Props = {
  disabled?: boolean
  exec: (cmd: string, payload?: any) => void
  isFullscreen?: boolean
}

export default function TiptapToolbar({ disabled, exec: dispatch, isFullscreen }: Props) {
  const fileInputId = 'editor-image-input'
  const exec = (cmd: string, payload?: any) => {
    if (disabled) return
    if (payload === undefined) dispatch(cmd)
    else dispatch(cmd, payload)
  }
  const openInsertMenu = () => {
    if (disabled) return
    document.dispatchEvent(new CustomEvent('open:insert-menu'))
  }
  const openImagePicker = () => {
    if (disabled) return
    ;(document.getElementById(fileInputId) as HTMLInputElement | null)?.click()
  }

  return (
    <div role="toolbar" aria-label="编辑器工具栏" className="editor-toolbar">
      <div className="editor-toolbar__tools">
        <Button size="icon" variant="ghost" aria-label="粗体" title="粗体 (Ctrl+B)" disabled={disabled} onClick={() => exec('bold')}><Bold className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="斜体" title="斜体 (Ctrl+I)" disabled={disabled} onClick={() => exec('italic')}><Italic className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="下划线" title="下划线 (Ctrl+U)" disabled={disabled} onClick={() => exec('underline')}><Underline className="w-4 h-4" aria-hidden /></Button>
        <div aria-hidden className="editor-toolbar__separator" />
        <select aria-label="样式" title="样式" disabled={disabled} className="editor-toolbar__select" onChange={(event) => {
          const value = event.target.value
          if (value === 'paragraph') exec('paragraph')
          else if (value.startsWith('h')) exec('heading', { level: Number(value.substring(1)) })
        }} defaultValue="paragraph">
          <option value="paragraph">正文</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="h4">H4</option>
          <option value="h5">H5</option>
          <option value="h6">H6</option>
        </select>
        <Button size="icon" variant="ghost" aria-label="标题二级" title="标题 (H2)" disabled={disabled} onClick={() => exec('heading', { level: 2 })}><Heading className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="有序列表" title="有序列表" disabled={disabled} onClick={() => exec('ol')}><ListOrdered className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="无序列表" title="无序列表" disabled={disabled} onClick={() => exec('ul')}><List className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="任务清单" title="任务清单" disabled={disabled} onClick={() => exec('task')}><ListChecks className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="引用" title="引用" disabled={disabled} onClick={() => exec('blockquote')}><Quote className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="代码" title="行内代码" disabled={disabled} onClick={() => exec('code')}><Code className="w-4 h-4" aria-hidden /></Button>
        <div aria-hidden className="editor-toolbar__separator" />
        <select aria-label="字号" title="字号" disabled={disabled} className="editor-toolbar__select" onChange={(event) => exec('fontSize', { size: `${event.target.value}px` })} defaultValue="15">
          {[13, 14, 15, 16, 18, 20, 24, 28].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <div role="group" aria-label="插入" className="editor-toolbar__group">
          <Button size="icon" variant="ghost" aria-label="插入更多内容" title="插入更多内容" disabled={disabled} onClick={openInsertMenu}><Plus className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="插入链接" title="插入链接 (Ctrl+K)" disabled={disabled} onClick={() => exec('link')}><LinkIcon className="w-4 h-4" aria-hidden /></Button>
          <input id={fileInputId} type="file" accept="image/*" className="sr-only" disabled={disabled} onChange={(event) => { if (disabled) return; const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => exec('image', { src: String(reader.result || '') }); reader.readAsDataURL(file); event.currentTarget.value = '' }} />
          <Button size="icon" variant="ghost" aria-label="插入图片" title="插入图片" disabled={disabled} onClick={openImagePicker}><ImageIcon className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="插入表格" title="插入表格 3x3" disabled={disabled} onClick={() => exec('table')}><Table className="w-4 h-4" aria-hidden /></Button>
        </div>
        <Button size="icon" variant="ghost" aria-label="取消链接" title="取消链接" disabled={disabled} onClick={() => exec('unlink')}><Unlink className="w-4 h-4" aria-hidden /></Button>
        <div className="editor-toolbar__group">
          <Button size="icon" variant="ghost" aria-label="左对齐" title="左对齐" disabled={disabled} onClick={() => exec('align', { align: 'left' })}><AlignLeft className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="居中" title="居中" disabled={disabled} onClick={() => exec('align', { align: 'center' })}><AlignCenter className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="右对齐" title="右对齐" disabled={disabled} onClick={() => exec('align', { align: 'right' })}><AlignRight className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="高亮" title="高亮" disabled={disabled} onClick={() => exec('highlight')}><Highlighter className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="上标" title="上标" disabled={disabled} onClick={() => exec('sup')}><Superscript className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="下标" title="下标" disabled={disabled} onClick={() => exec('sub')}><Subscript className="w-4 h-4" aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="插入分隔线" title="插入分隔线" disabled={disabled} onClick={() => exec('hr')}><Highlighter className="w-4 h-4" aria-hidden /></Button>
          <input type="color" aria-label="文字颜色" title="文字颜色" disabled={disabled} className="editor-toolbar__color" onChange={(event) => exec('color', { color: event.target.value })} />
        </div>
        <div aria-hidden className="editor-toolbar__separator" />
        <Button size="icon" variant="ghost" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={disabled} onClick={() => exec('undo')}><Undo2 className="w-4 h-4" aria-hidden /></Button>
        <Button size="icon" variant="ghost" aria-label="重做" title="重做 (Ctrl+Y)" disabled={disabled} onClick={() => exec('redo')}><Redo2 className="w-4 h-4" aria-hidden /></Button>
        <Button id="save-button" size="icon" aria-label="保存" title="保存 (Ctrl+S)" disabled={disabled} onClick={() => exec('save')}><Save className="w-4 h-4" aria-hidden /></Button>
      </div>
      <div className="editor-toolbar__actions">
        <span className="editor-toolbar__hint">支持 Markdown 快捷输入</span>
        <span className="editor-tooltip" data-tooltip="评论"><Button size="icon" variant="ghost" aria-label={disabled ? '打开评论' : '评论'} title="评论 (Alt+C)" disabled={disabled} onClick={() => exec('comments')}><MessageSquare className="w-4 h-4" aria-hidden /></Button></span>
        <span className="editor-tooltip" data-tooltip="协作成员"><Button size="icon" variant="ghost" aria-label="协作成员" title="协作成员" onClick={() => dispatch('collab')}><Users className="w-4 h-4" aria-hidden /></Button></span>
        <Button id="fullscreen-button" size="icon" variant="ghost" aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title="切换全屏 (Ctrl+Shift+F)" aria-pressed={Boolean(isFullscreen)} onClick={() => dispatch('fullscreen')}>
          {isFullscreen ? <Minimize className="w-4 h-4" aria-hidden /> : <Maximize className="w-4 h-4" aria-hidden />}
        </Button>
      </div>
    </div>
  )
}
