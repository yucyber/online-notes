import { useRef, useState } from 'react'

export function useNoteEditorPage() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [linkHref, setLinkHref] = useState('https://')

  return {
    editorContainerRef,
    isFullscreen,
    linkHref,
    setIsFullscreen,
    setLinkHref,
    setShowInsertMenu,
    setShowLinkDialog,
    setShowSidebar,
    showInsertMenu,
    showLinkDialog,
    showSidebar,
  }
}
