import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MindmapDetailPage from '@/app/dashboard/mindmaps/[id]/page'
import { mindmapsAPI } from '@/lib/api'
import { getAIMindMapData } from '@/lib/ai-client'
import { appToast } from '@/lib/app-toast'

const setMindMapData = jest.fn()
const setIsAILoading = jest.fn()
const push = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'mindmap-1' }),
  useRouter: () => ({ push }),
}))

jest.mock('next/dynamic', () => () => function MindmapStub() {
  return <div data-testid="mindmap-canvas" />
})

jest.mock('@/lib/api', () => ({
  mindmapsAPI: { get: jest.fn(), create: jest.fn(), update: jest.fn() },
}))

jest.mock('@/lib/ai-client', () => ({
  getAIMindMapData: jest.fn(),
}))

jest.mock('@/context/AIContext', () => ({
  useAI: () => ({ setMindMapData, setIsAILoading, isAILoading: false }),
}))

jest.mock('@/lib/app-toast', () => ({
  appToast: { success: jest.fn(), error: jest.fn() },
}))

describe('MindmapDetailPage AI 生成', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(mindmapsAPI.get).mockResolvedValue({
      id: 'mindmap-1',
      title: '思维导图',
      noteId: 'note-1',
      noteTitle: '来源笔记',
    })
  })

  it('生成失败时使用公共 Toast，不调用原生 alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    jest.mocked(getAIMindMapData).mockRejectedValue(new Error('AI unavailable'))
    render(<MindmapDetailPage />)

    fireEvent.change(await screen.findByPlaceholderText('输入主题让 AI 生成...'), {
      target: { value: '前端' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }))

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith(expect.objectContaining({
        id: 'mindmap:ai-generate',
        title: 'AI 生成失败',
      }))
    })
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('发布业务面包屑并返回来源笔记', async () => {
    const breadcrumbs = jest.fn()
    document.addEventListener('dashboard:breadcrumbs', breadcrumbs)
    render(<MindmapDetailPage />)

    fireEvent.click(await screen.findByRole('button', { name: '返回' }))

    expect(push).toHaveBeenCalledWith('/dashboard/notes/note-1')
    await waitFor(() => expect(breadcrumbs).toHaveBeenCalled())
    const details = breadcrumbs.mock.calls.map(([event]) => (event as CustomEvent).detail).filter(Boolean)
    expect(details.at(-1)?.items).toEqual([
      { label: '我的笔记', href: '/dashboard/notes' },
      { label: '来源笔记', href: '/dashboard/notes/note-1' },
      { label: '思维导图' },
    ])
    document.removeEventListener('dashboard:breadcrumbs', breadcrumbs)
  })

  it('404 时不再自动创建孤儿思维导图', async () => {
    jest.mocked(mindmapsAPI.get).mockRejectedValue({ response: { status: 404 } })
    render(<MindmapDetailPage />)

    expect(await screen.findByText('思维导图不存在')).toBeInTheDocument()
    expect(mindmapsAPI.create).not.toHaveBeenCalled()
  })
})
