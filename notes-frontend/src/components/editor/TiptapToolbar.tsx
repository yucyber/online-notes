"use client"
import { Button } from '@/components/ui/button'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'

import { DEFAULT_EDITOR_FORMAT_STATE, type EditorFormatState } from './editor-format-state'

type Props = {
  disabled?: boolean
  exec: (cmd: string, payload?: any) => void
  isFullscreen?: boolean
  formatState?: EditorFormatState
}

export default function TiptapToolbar({ disabled, exec: dispatch, isFullscreen, formatState = DEFAULT_EDITOR_FORMAT_STATE }: Props) {
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
        <Button size="icon" variant="ghost" aria-label="粗体" aria-pressed={formatState.bold} title="粗体 (Ctrl+B)" disabled={disabled} onClick={() => exec('bold')}><PrototypeGlyph name="bold" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="斜体" aria-pressed={formatState.italic} title="斜体 (Ctrl+I)" disabled={disabled} onClick={() => exec('italic')}><PrototypeGlyph name="italic" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="下划线" aria-pressed={formatState.underline} title="下划线 (Ctrl+U)" disabled={disabled} onClick={() => exec('underline')}><PrototypeGlyph name="underline" className="w-4 h-4" /></Button>
        <div aria-hidden className="editor-toolbar__separator" />
        <select aria-label="样式" title="样式" disabled={disabled} className="editor-toolbar__select" onChange={(event) => {
          const value = event.target.value
          if (value === 'paragraph') exec('paragraph')
          else if (value.startsWith('h')) exec('heading', { level: Number(value.substring(1)) })
        }} value={formatState.block}>
          <option value="paragraph">正文</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="h4">H4</option>
          <option value="h5">H5</option>
          <option value="h6">H6</option>
        </select>
        <Button size="icon" variant="ghost" aria-label="标题二级" aria-pressed={formatState.block === 'h2'} title="标题 (H2)" disabled={disabled} onClick={() => exec('heading', { level: 2 })}><PrototypeGlyph name="heading" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="有序列表" aria-pressed={formatState.orderedList} title="有序列表" disabled={disabled} onClick={() => exec('ol')}><PrototypeGlyph name="ordered-list" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="无序列表" aria-pressed={formatState.bulletList} title="无序列表" disabled={disabled} onClick={() => exec('ul')}><PrototypeGlyph name="list" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="任务清单" aria-pressed={formatState.taskList} title="任务清单" disabled={disabled} onClick={() => exec('task')}><PrototypeGlyph name="tasks" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="引用" aria-pressed={formatState.blockquote} title="引用" disabled={disabled} onClick={() => exec('blockquote')}><PrototypeGlyph name="quote" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="代码" aria-pressed={formatState.code} title="行内代码" disabled={disabled} onClick={() => exec('code')}><PrototypeGlyph name="code" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="高亮" aria-pressed={formatState.highlight} title="高亮" disabled={disabled} onClick={() => exec('highlight')}><PrototypeGlyph name="highlight" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="上标" aria-pressed={formatState.sup} title="上标" disabled={disabled} onClick={() => exec('sup')}><PrototypeGlyph name="superscript" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="下标" aria-pressed={formatState.sub} title="下标" disabled={disabled} onClick={() => exec('sub')}><PrototypeGlyph name="subscript" className="w-4 h-4" /></Button>
        <div aria-hidden className="editor-toolbar__separator" />
        <select aria-label="字号" title="字号" disabled={disabled} className="editor-toolbar__select" onChange={(event) => exec('fontSize', { size: `${event.target.value}px` })} value={formatState.fontSize}>
          {[13, 14, 15, 16, 18, 20, 24, 28].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <div role="group" aria-label="对齐" className="editor-toolbar__group">
          <Button size="icon" variant="ghost" aria-label="左对齐" aria-pressed={formatState.textAlign === 'left'} title="左对齐" disabled={disabled} onClick={() => exec('align', { align: 'left' })}><PrototypeGlyph name="align-left" className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="居中对齐" aria-pressed={formatState.textAlign === 'center'} title="居中对齐" disabled={disabled} onClick={() => exec('align', { align: 'center' })}><PrototypeGlyph name="align-center" className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="右对齐" aria-pressed={formatState.textAlign === 'right'} title="右对齐" disabled={disabled} onClick={() => exec('align', { align: 'right' })}><PrototypeGlyph name="align-right" className="w-4 h-4" /></Button>
        </div>
        <div role="group" aria-label="链接" className="editor-toolbar__group">
          <Button size="icon" variant="ghost" aria-label="插入链接" title="插入链接 (Ctrl+K)" disabled={disabled} onClick={() => exec('link')}><PrototypeGlyph name="link" className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="取消链接" title="取消链接" disabled={disabled} onClick={() => exec('unlink')}><PrototypeGlyph name="unlink" className="w-4 h-4" /></Button>
        </div>
        <div role="group" aria-label="插入" className="editor-toolbar__group">
          <Button id="editor-insert-trigger" size="icon" variant="ghost" aria-label="插入更多内容" title="插入更多内容" disabled={disabled} onClick={openInsertMenu}><PrototypeGlyph name="plus" className="w-4 h-4" /></Button>
          <input id={fileInputId} type="file" accept="image/*" className="sr-only" disabled={disabled} onChange={(event) => { if (disabled) return; const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => exec('image', { src: String(reader.result || '') }); reader.readAsDataURL(file); event.currentTarget.value = '' }} />
          <Button size="icon" variant="ghost" aria-label="插入图片" title="插入图片" disabled={disabled} onClick={openImagePicker}><PrototypeGlyph name="image" className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="插入表格" title="插入表格 3x3" disabled={disabled} onClick={() => exec('table')}><PrototypeGlyph name="table" className="w-4 h-4" /></Button>
        </div>
        <div aria-hidden className="editor-toolbar__separator" />
        <Button size="icon" variant="ghost" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={disabled} onClick={() => exec('undo')}><PrototypeGlyph name="undo" className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="重做" title="重做 (Ctrl+Y)" disabled={disabled} onClick={() => exec('redo')}><PrototypeGlyph name="redo" className="w-4 h-4" /></Button>
        <Button id="save-button" size="icon" aria-label="保存" title="保存 (Ctrl+S)" disabled={disabled} onClick={() => exec('save')}><PrototypeGlyph name="save" className="w-4 h-4" /></Button>
      </div>
      <div className="editor-toolbar__actions">
        <span className="editor-toolbar__hint">支持 Markdown 快捷输入</span>
        <Button id="fullscreen-button" size="icon" variant="ghost" aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title="切换全屏 (Ctrl+Shift+F)" aria-pressed={Boolean(isFullscreen)} onClick={() => dispatch('fullscreen')}>
          <PrototypeGlyph name={isFullscreen ? 'minimize' : 'maximize'} className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
