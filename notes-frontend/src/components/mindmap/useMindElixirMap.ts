import { useCallback, useRef, useState } from 'react'
import { mindmapsAPI } from '@/lib/api'
import { appToast } from '@/lib/app-toast'

export function useMindElixirMap(id: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mindElixirInstance, setMindElixirInstance] = useState<any>(null)

  const handleSave = useCallback(() => {
    if (!mindElixirInstance) return
    const data = mindElixirInstance.getData()
    mindmapsAPI.save(id, data).then(() => {
      appToast.success({ id: 'mindmap:save', title: '保存成功' })
    }).catch((error) => {
      console.error('保存失败', error)
      appToast.error({
        id: 'mindmap:save',
        title: '保存失败',
        message: '请稍后重试。',
      })
    })
  }, [id, mindElixirInstance])

  return { containerRef, handleSave, mindElixirInstance, setMindElixirInstance }
}
