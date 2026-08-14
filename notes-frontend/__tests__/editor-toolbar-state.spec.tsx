import { render, screen } from '@testing-library/react'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import { DEFAULT_EDITOR_FORMAT_STATE } from '@/components/editor/editor-format-state'

describe('TiptapToolbar format state', () => {
  test('reflects the block, font size and active marks at the cursor', () => {
    render(
      <TiptapToolbar
        exec={() => undefined}
        formatState={{
          ...DEFAULT_EDITOR_FORMAT_STATE,
          block: 'h2',
          fontSize: '18',
          bold: true,
          orderedList: true,
        }}
      />,
    )

    expect(screen.getByRole('combobox', { name: '样式' })).toHaveValue('h2')
    expect(screen.getByRole('combobox', { name: '字号' })).toHaveValue('18')
    expect(screen.getByRole('button', { name: '粗体' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '有序列表' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '斜体' })).toHaveAttribute('aria-pressed', 'false')
  })
})
