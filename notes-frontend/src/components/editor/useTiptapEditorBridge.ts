import { useEffect, useRef } from 'react'

type Props = {
  onSelectionChange?: (start: number, end: number) => void
  onContentChange?: (html: string) => void
  onSave: (html: string) => Promise<void>
}

export function useTiptapEditorBridge({ onSelectionChange, onContentChange, onSave }: Props) {
  // useEditor 的事件处理器只在初次挂载时创建，之后不会重新注册。
  // 用 ref 保存最新回调，事件处理器调用 ref.current 就能始终拿到父组件传入的最新函数，
  // 避免因闭包捕获旧引用而丢失保存或选区变化通知。
  const onSelectionChangeRef = useRef<typeof onSelectionChange | null>(onSelectionChange)
  const onContentChangeRef = useRef<typeof onContentChange | null>(onContentChange)
  const onSaveRef = useRef<typeof onSave | null>(onSave)

  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
  useEffect(() => { onContentChangeRef.current = onContentChange }, [onContentChange])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  return { onSelectionChangeRef, onContentChangeRef, onSaveRef }
}
