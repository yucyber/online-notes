'use client'
import { listVersions, snapshotVersion, restoreVersion, fetchNoteById } from '@/lib/api'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Suspense, useEffect, useState } from 'react'

export default function VersionsPage() {
  const params = useParams()
  const noteId = params?.id as string
  const router = useRouter()
  const [versions, setVersions] = useState<any[]>([])
  const [note, setNote] = useState<any>(null)
  const load = async () => {
    if (!noteId) return
    const v = await listVersions(noteId)
    setVersions(v || [])
    const n = await fetchNoteById(noteId)
    setNote(n)
  }
  useEffect(() => { load() }, [noteId])
  const snapshot = async () => {
    const name = window.prompt('请输入版本名称（可选）')
    if (name === null) return
    await snapshotVersion(noteId, name || undefined)
    await load()
  }
  const restore = async (no: number) => {
    await restoreVersion(noteId, no)
    await load()
    try { sessionStorage.setItem('restoredVersion', String(no)) } catch { }
    router.push(`/dashboard/notes/${noteId}/edit?restored=${no}`)
  }
  return (
    <Suspense>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">版本</div>
          <Button onClick={snapshot}>创建快照</Button>
        </div>
        <div className="text-sm text-gray-600">当前：{note?.title}</div>
        <ul className="space-y-2">
          {versions.map(v => (
            <li key={v.versionNo} className="flex items-center justify-between border rounded px-3 py-2">
              <span className="text-sm">
                #{v.versionNo}
                {v.name ? <span className="mx-2 font-medium text-blue-600">{v.name}</span> : ''}
                <span className="text-gray-500">· {new Date(v.createdAt).toLocaleString()}</span>
              </span>
              <Button variant="outline" onClick={() => restore(v.versionNo)}>恢复</Button>
            </li>
          ))}
          {versions.length === 0 && <div className="text-sm text-gray-500">暂无版本</div>}
        </ul>
      </div>
    </Suspense>
  )
}
