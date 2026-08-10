import { useCallback, useRef, useState } from 'react'
import { mindmapsAPI } from '@/lib/api'

export function useMindElixirMap(id: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mindElixirInstance, setMindElixirInstance] = useState<any>(null)

  const handleSave = useCallback(() => {
    if (!mindElixirInstance) return
    const data = mindElixirInstance.getData()
    mindmapsAPI.save(id, data).then(() => {
      alert('保存成功')
    }).catch((error) => {
      console.error('保存失败', error)
      alert('保存失败')
    })
  }, [id, mindElixirInstance])

  return { containerRef, handleSave, mindElixirInstance, setMindElixirInstance }
}
