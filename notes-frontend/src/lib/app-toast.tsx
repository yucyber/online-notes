'use client'

import { toast } from 'react-hot-toast'
import { AppToastCard } from '@/components/ui/AppToaster'

export type AppToastOptions = {
  id: string
  title: string
  message?: string
  action?: { label: string; onClick: () => void }
  persistent?: boolean
}

const activeToastIds: string[] = []

function rememberToastId(id: string) {
  if (activeToastIds.includes(id)) return

  // 限制并发错误提示，避免保存或协作失败遮挡编辑内容。
  if (activeToastIds.length >= 3) {
    const oldestId = activeToastIds.shift()
    if (oldestId) toast.dismiss(oldestId)
  }

  activeToastIds.push(id)
}

export const appToast = {
  error(options: AppToastOptions) {
    rememberToastId(options.id)

    return toast.custom(
      (instance) => <AppToastCard toastId={instance.id} tone="error" {...options} />,
      {
        id: options.id,
        duration: options.persistent ? Infinity : 5000,
        position: 'top-right',
      },
    )
  },
  success(options: AppToastOptions) {
    rememberToastId(options.id)

    return toast.custom(
      (instance) => <AppToastCard toastId={instance.id} tone="success" {...options} />,
      {
        id: options.id,
        duration: options.persistent ? Infinity : 4000,
        position: 'top-right',
      },
    )
  },
  dismiss(id?: string) {
    toast.dismiss(id)
  },
}
