import { act, renderHook, waitFor } from '@testing-library/react'
import { useMindElixirMap } from '@/components/mindmap/useMindElixirMap'
import { mindmapsAPI } from '@/lib/api'
import { appToast } from '@/lib/app-toast'

jest.mock('@/lib/api', () => ({ mindmapsAPI: { save: jest.fn() } }))
jest.mock('@/lib/app-toast', () => ({ appToast: { success: jest.fn(), error: jest.fn() } }))

describe('useMindElixirMap 保存提示', () => {
  beforeEach(() => jest.clearAllMocks())

  it('保存成功时使用公共 Toast，不调用原生 alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    jest.mocked(mindmapsAPI.save).mockResolvedValue(undefined)
    const { result } = renderHook(() => useMindElixirMap('mindmap-1'))

    act(() => result.current.setMindElixirInstance({ getData: () => ({ nodeData: { id: 'root' } }) }))
    act(() => result.current.handleSave())

    await waitFor(() => expect(appToast.success).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mindmap:save', title: '保存成功',
    })))
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('保存失败时使用公共 Toast，不调用原生 alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    jest.mocked(mindmapsAPI.save).mockRejectedValue(new Error('save failed'))
    const { result } = renderHook(() => useMindElixirMap('mindmap-1'))

    act(() => result.current.setMindElixirInstance({ getData: () => ({ nodeData: { id: 'root' } }) }))
    act(() => result.current.handleSave())

    await waitFor(() => expect(appToast.error).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mindmap:save', title: '保存失败',
    })))
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
