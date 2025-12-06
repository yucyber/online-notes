import React from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('next/navigation', () => {
  const params = new URLSearchParams('')
  return {
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => params,
  }
})

jest.mock('@/lib/api', () => {
  return {
    fetchNotes: jest.fn(async () => ({ items: [], page: 1, size: 20, total: 0 })),
    fetchCategories: jest.fn(async () => []),
    fetchTags: jest.fn(async () => []),
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
    jest.resetModules()
  })

  test('SearchFilterBar 触发 search:trigger 并写入 searchId', async () => {
    const { default: SearchFilterBar } = await import('@/components/SearchFilterBar')

    let triggerDetail: any = null
    document.addEventListener('search:trigger', (e: any) => { triggerDetail = e.detail })

    render(<SearchFilterBar />)

    const input = screen.getByPlaceholderText('搜索笔记...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    const btn = screen.getByText('搜索')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(triggerDetail).toBeTruthy()
      expect(triggerDetail.searchId).toBeTruthy()
      expect(sessionStorage.getItem('lastSearchId')).toBe(triggerDetail.searchId)
      expect(triggerDetail.source).toBe('button')
    })
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

