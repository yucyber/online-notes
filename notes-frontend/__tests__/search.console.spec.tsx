import React from 'react'
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('next/navigation', () => {
  const params = new URLSearchParams('')
  return {
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => params,
    usePathname: () => '/dashboard/notes',
  }
})

jest.mock('@/lib/api', () => {
  return {
    fetchNotes: jest.fn(async () => ({ items: [], page: 1, size: 20, total: 0 })),
    fetchCategories: jest.fn(async () => []),
    fetchTags: jest.fn(async () => []),
    categoriesAPI: { getAll: jest.fn(async () => []) },
    tagsAPI: { getAll: jest.fn(async () => []) },
    savedFiltersAPI: {
      getAll: jest.fn(async () => []),
      create: jest.fn(async () => ({})),
    },
  }
})

describe('搜索→控制台联动', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    ;(global as any).performance = {
      mark: jest.fn(),
      measure: jest.fn(),
      getEntriesByName: jest.fn(() => [{ duration: 123 }]),
    }
    sessionStorage.clear()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('SearchFilterBar 触发 search:trigger 并写入 searchId', async () => {
    const { default: SearchFilterBar } = await import('@/components/SearchFilterBar')

    let triggerDetail: any = null
    document.addEventListener('search:trigger', (e: any) => { triggerDetail = e.detail })

    render(<SearchFilterBar />)
    await act(async () => { await Promise.resolve() })

    const input = screen.getByPlaceholderText('搜索标题、内容或标签') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))

    await waitFor(() => {
      expect(triggerDetail).toBeTruthy()
      expect(triggerDetail.searchId).toBeTruthy()
      expect(sessionStorage.getItem('lastSearchId')).toBe(triggerDetail.searchId)
      expect(triggerDetail.source).toBe('button')
    })
  })

  test('筛选与语义搜索展示可操作选项且互不覆盖', async () => {
    const { default: SearchFilterBar } = await import('@/components/SearchFilterBar')
    render(<SearchFilterBar />)
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    expect(screen.getByRole('dialog', { name: '高级筛选' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: '语义搜索模式' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '语义搜索' }))
    expect(screen.queryByRole('dialog', { name: '高级筛选' })).not.toBeInTheDocument()
    const semanticDialog = screen.getByRole('dialog', { name: '语义搜索模式' })
    expect(semanticDialog).toBeVisible()
    expect(screen.getByRole('button', { name: /混合检索/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /语义优先/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /关键词优先/ })).toBeVisible()
  })

  test('NotesPage 完成加载后派发 search:result 与 RUM 事件', async () => {
    const { default: NotesPage } = await import('@/app/dashboard/notes/page')
    const results: any[] = []
    const rums: any[] = []
    document.addEventListener('search:result', (e: any) => results.push(e.detail))
    document.addEventListener('rum', (e: any) => {
      if (e.detail?.type === 'ui:search_results') rums.push(e.detail)
    })

    sessionStorage.setItem('lastSearchId', 'test_sid_123')
    Object.defineProperty(window, 'location', {
      value: { search: '?keyword=abc' },
      writable: true,
    })

    render(<NotesPage />)

    await waitFor(() => {
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].ok).toBe(true)
      expect(results[0].searchId).toBe('test_sid_123')
    })

    await waitFor(() => {
      expect(rums.length).toBeGreaterThan(0)
      expect(rums[0].meta.searchId).toBe('test_sid_123')
    })
  })
})
