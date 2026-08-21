import { fireEvent, render, screen } from '@testing-library/react'
import { Select } from '@/components/ui/select'

const options = [
  { value: '', label: '未分类' },
  { value: 'cli', label: 'cli' },
  { value: 'skill', label: 'skill' },
]

describe('Select', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    })
  })

  test('支持键盘选择下一个分类', () => {
    const onChange = jest.fn()
    render(<Select value="" options={options} onChange={onChange} />)

    const trigger = screen.getByRole('button', { name: '未分类' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('cli')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('Escape 关闭列表且禁用状态无法打开', () => {
    const { rerender } = render(<Select value="" options={options} onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '未分类' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    rerender(<Select value="" options={options} onChange={() => undefined} disabled />)
    fireEvent.click(screen.getByRole('button', { name: '未分类' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('展开期间变为禁用会立即关闭列表', () => {
    const { rerender } = render(<Select value="" options={options} onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '未分类' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    rerender(<Select value="" options={options} onChange={() => undefined} disabled />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
