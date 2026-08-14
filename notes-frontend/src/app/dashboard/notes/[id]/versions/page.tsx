'use client'
import { listVersions, snapshotVersion, restoreVersion, fetchNoteById } from '@/lib/api'
import { useRouter, useParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'

export default function VersionsPage() {
  const params = useParams()
  const noteId = params?.id as string
  const router = useRouter()
  const [versions, setVersions] = useState<any[]>([])
  const [note, setNote] = useState<any>(null)
  const load = useCallback(async () => {
    if (!noteId) return
    const v = await listVersions(noteId)
    setVersions(v || [])
    const n = await fetchNoteById(noteId)
    setNote(n)
  }, [noteId])
  useEffect(() => { load() }, [noteId, load])
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
    router.push(`/dashboard/notes/${noteId}?restored=${no}`)
  }
  return (
    <Suspense>
      <div>
        <div className="prototype-section-head">
          <div>
            <h1 className="page-heading">版本记录</h1>
            <p className="page-description">查看快照并在需要时恢复历史内容。</p>
          </div>
          <button type="button" className="prototype-button prototype-button--primary" onClick={snapshot}><PrototypeGlyph name="plus" />创建快照</button>
        </div>
        <ul className="product-version-line">
          <li><time>当前版本<br/>刚刚</time><div><h3>{note?.title || '无标题笔记'}</h3><p>自动保存 · 当前编辑内容</p></div></li>
          {versions.map(v => (
            <li key={v.versionNo}>
              <time>{new Date(v.createdAt).toLocaleString()}</time>
              <div><h3>{v.name || `版本 ${v.versionNo}`}</h3><p>手动快照 · #{v.versionNo}</p><p className="mt-2"><button className="prototype-link-button" onClick={() => restore(v.versionNo)}>恢复此版本</button></p></div>
            </li>
          ))}
        </ul>
      </div>
    </Suspense>
  )
}
