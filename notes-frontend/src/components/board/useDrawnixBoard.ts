'use client'

import { useEffect, useRef, useState } from 'react'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw'
import { boardsAPI } from '@/lib/api'
import { getAIMermaidData } from '@/lib/ai-client'
import { replaceWithLibraryItems } from './board-library'

type Props = { id: string; initialData: any; readonly: boolean }

export function useDrawnixBoard({ id, initialData, readonly }: Props) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showAIDialog, setShowAIDialog] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [libraryItems, setLibraryItems] = useState<any[]>(() => initialData?.libraryItems || [])
  const [initData, setInitData] = useState<any>(() => initialData?.elements ? initialData : null)
  const syncedLibraryApiRef = useRef<any>(null)

  useEffect(() => {
    if (!initialData) return
    if (initialData.elements) {
      setInitData(initialData)
      if (initialData.libraryItems) setLibraryItems(initialData.libraryItems)
    } else if (initialData.imageData) {
      console.warn('Legacy image data detected, starting fresh.')
    }
  }, [initialData])

  useEffect(() => {
    // syncedLibraryApiRef 记录上次已同步的 API 实例；API 变更时才更新库，防止重复写入。
    if (excalidrawAPI && syncedLibraryApiRef.current !== excalidrawAPI) {
      syncedLibraryApiRef.current = excalidrawAPI
      if (libraryItems.length === 0) return
      try { excalidrawAPI.updateLibrary({ libraryItems, merge: true }) } catch (error) { console.error('Failed to update library', error) }
    }
  }, [excalidrawAPI, libraryItems])

  useEffect(() => {
    if (!excalidrawAPI) return
    // Excalidraw 官方库分享格式：用 URL hash 的 addLibrary 参数传递远程库地址。
    const handleHashChange = async () => {
      const libraryUrl = new URLSearchParams(window.location.hash.slice(1)).get('addLibrary')
      if (!libraryUrl) return
      try {
        const response = await fetch(decodeURIComponent(libraryUrl))
        const data = JSON.parse(await response.text())
        const items = Array.isArray(data) ? data : data.libraryItems || data.library || []
        if (items.length > 0) {
          excalidrawAPI.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true })
          window.history.replaceState(null, '', window.location.pathname)
        }
      } catch (error) { console.error('Failed to load library:', error) }
    }
    void handleHashChange()
  }, [excalidrawAPI])

  const handleSave = async () => {
    if (!excalidrawAPI) return
    setIsSaving(true)
    try {
      const appState = excalidrawAPI.getAppState()
      await boardsAPI.save(id, {
        elements: excalidrawAPI.getSceneElements(),
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          currentItemFontFamily: appState.currentItemFontFamily,
          currentItemStrokeColor: appState.currentItemStrokeColor,
          currentItemBackgroundColor: appState.currentItemBackgroundColor,
          currentItemFillStyle: appState.currentItemFillStyle,
          currentItemStrokeWidth: appState.currentItemStrokeWidth,
          currentItemStrokeStyle: appState.currentItemStrokeStyle,
          currentItemRoughness: appState.currentItemRoughness,
          currentItemOpacity: appState.currentItemOpacity,
          gridSize: appState.gridSize,
        },
        files: excalidrawAPI.getFiles(),
        libraryItems,
      })
    } catch (error) {
      console.error('保存失败', error)
      alert('保存失败')
    } finally { setIsSaving(false) }
  }

  useEffect(() => {
    if (!showAIDialog || !excalidrawAPI) return
    const fetchLibrary = async () => {
      try {
        const items = await excalidrawAPI.updateLibrary({ libraryItems: [], merge: true, openLibraryMenu: false })
        if (items) setLibraryItems(items)
      } catch (error) { console.warn('Failed to refresh library items', error) }
    }
    void fetchLibrary()
  }, [showAIDialog, excalidrawAPI])

  const handleAddLibraryItem = () => {
    if (!excalidrawAPI) return
    const appState = excalidrawAPI.getAppState()
    const selectedElements = excalidrawAPI.getSceneElements().filter((element: any) => appState.selectedElementIds[element.id])
    if (selectedElements.length === 0) { alert('请先在画布上选择一个或多个元素，然后点击此按钮将其注册为 AI 素材。'); return }
    const name = prompt('请输入素材名称 (英文，例如: Database, User):\nAI 将根据此名称来引用素材。')
    if (!name?.trim()) return
    const newItems = [{ id: Date.now().toString(), status: 'published', elements: selectedElements.map((element: any) => ({ ...element })), name: name.trim(), created: Date.now() }, ...libraryItems]
    setLibraryItems(newItems)
    excalidrawAPI.updateLibrary({ libraryItems: newItems, openLibraryMenu: true })
    alert(`已添加素材 "${name}"！\n现在您可以在 AI 生成对话框中看到它了。`)
  }

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return
    setIsGenerating(true)
    try {
      const availableIcons = libraryItems.filter((item) => item.name).map((item) => item.name)
      const mermaidCode = await getAIMermaidData(aiPrompt, availableIcons)
      const { elements } = await parseMermaidToExcalidraw(mermaidCode)
      elements.forEach((element: any) => { element.roughness = 1; element.strokeWidth = 1; element.fillStyle = 'hachure'; element.strokeSharpness = 'round'; if (element.type === 'text') { element.fontFamily = 1; element.fontSize = 16 } })
      if (excalidrawAPI) {
        const standardElements = convertToExcalidrawElements(elements)
        excalidrawAPI.updateScene({ elements: [...excalidrawAPI.getSceneElements(), ...replaceWithLibraryItems(standardElements, libraryItems)] })
      }
      setShowAIDialog(false)
      setAiPrompt('')
    } catch (error) { console.error(error); alert(`生成失败: ${(error as Error).message}`) }
    finally { setIsGenerating(false) }
  }

  return { excalidrawAPI, setExcalidrawAPI, isSaving, showAIDialog, setShowAIDialog, aiPrompt, setAiPrompt, isGenerating, libraryItems, setLibraryItems, initData, readonly, handleSave, handleAddLibraryItem, handleAIGenerate }
}
