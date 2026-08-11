import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { toast } from 'react-hot-toast'
import { AppToastCard, AppToaster } from '@/components/ui/AppToaster'
import { appToast } from '@/lib/app-toast'

jest.mock('react-hot-toast', () => ({
  Toaster: () => null,
  toast: {
    custom: jest.fn(),
    dismiss: jest.fn(),
  },
}))

describe('app toast', () => {
  it('mounts one top-right toaster with accessible defaults', () => {
    render(<AppToaster />)

    expect(screen.getByTestId('app-toaster')).toHaveAttribute('aria-live', 'polite')
  })

  it('reuses the supplied id and exposes a named action', () => {
    const retry = jest.fn()

    appToast.error({
      id: 'save:n1',
      title: '保存失败',
      action: { label: '重新保存', onClick: retry },
      persistent: true,
    })

    expect(toast.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: 'save:n1', duration: Infinity }),
    )
  })

  it('shows the close notification tooltip when its icon button receives focus', async () => {
    render(<AppToastCard toastId="save:n1" tone="error" title="保存失败" />)

    fireEvent.focus(screen.getByRole('button', { name: '关闭提示' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('关闭通知')
  })
})
