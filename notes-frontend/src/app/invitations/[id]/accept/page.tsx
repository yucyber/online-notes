'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { previewInvitation, acceptInvitation } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function AcceptInvitationPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        const data = await previewInvitation(id)
        setInfo(data)
        setError('')
      } catch {
        setError('邀请已失效或不存在')
      } finally {
        setLoading(false)
      }
    }
    if (id) run()
  }, [id])

  const handleAccept = async () => {
    try {
      await acceptInvitation(id)
      router.replace(`/dashboard/notes/${info?.noteId}`)
    } catch {
      setError('接受失败，请登录后重试')
    }
  }

  if (loading) return <div className="p-8 text-center">加载中...</div>
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>

  return (
    <div className="p-8 max-w-lg mx-auto space-y-4">
      <div className="text-lg font-semibold">接受邀请</div>
      <div className="text-sm text-gray-600">笔记：{info?.noteId}</div>
      <div className="text-sm text-gray-600">角色：{info?.role}</div>
      <div className="text-sm text-gray-600">有效期：{info?.expiresAt}</div>
      <Button onClick={handleAccept}>接受并进入</Button>
    </div>
  )
}
