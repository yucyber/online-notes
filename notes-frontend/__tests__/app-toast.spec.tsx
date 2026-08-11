import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { toast } from 'react-hot-toast'
import { AppToaster } from '@/components/ui/AppToaster'
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
})
