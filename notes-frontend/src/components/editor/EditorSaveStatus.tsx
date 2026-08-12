import type { SaveState } from './useEditorAutoSave'

const labels: Partial<Record<SaveState, string>> = {
  saving: '正在保存…',
  saved: '已自动保存',
  local: '已保存到本地',
  error: '保存失败',
}

export function EditorSaveStatus({ state }: { state: SaveState }) {
  const label = labels[state]
  if (!label) return null

  return <span className="text-xs text-gray-500" aria-live="polite">{label}</span>
}
