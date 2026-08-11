'use client'

import { AlertCircle, X } from 'lucide-react'
import { Toaster, toast } from 'react-hot-toast'

type AppToastCardProps = {
  toastId: string
  tone: 'error'
  title: string
  message?: string
  action?: { label: string; onClick: () => void }
}

export function AppToastCard({ toastId, tone, title, message, action }: AppToastCardProps) {
  return (
    <div
      className="flex w-[360px] items-start gap-3 rounded-xl border border-red-200 bg-[var(--surface-1)] p-4 text-[var(--on-surface)] shadow-lg"
      role="status"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {message && <p className="mt-1 text-sm text-[var(--text-secondary)]">{message}</p>}
        {action && (
          <button
            type="button"
            className="mt-3 text-sm font-medium text-[var(--primary-600)] hover:underline"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="-mr-1 -mt-1 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--on-surface)]"
        aria-label="关闭提示"
        onClick={() => toast.dismiss(toastId)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export function AppToaster() {
  return (
    <div data-testid="app-toaster" aria-live="polite">
      <Toaster position="top-right" />
    </div>
  )
}
