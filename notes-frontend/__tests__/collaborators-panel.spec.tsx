import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import { aclAPI, invitationsAPI } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  aclAPI: { get: jest.fn() },
  invitationsAPI: { list: jest.fn(), create: jest.fn() },
}))

describe('CollaboratorsPanel 请求刷新策略', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    ;(aclAPI.get as jest.Mock).mockResolvedValue({ visibility: 'private', acl: [] })
    ;(invitationsAPI.list as jest.Mock).mockResolvedValue([])
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  test('静置时不按固定间隔重复请求 ACL', async () => {
    render(<CollaboratorsPanel noteId="note-1" />)
    await waitFor(() => expect(aclAPI.get).toHaveBeenCalledTimes(1))

    await act(async () => { jest.advanceTimersByTime(15_000) })

    expect(aclAPI.get).toHaveBeenCalledTimes(1)
    expect(invitationsAPI.list).toHaveBeenCalledTimes(1)
  })

  test('用户手动刷新时重新加载协作状态', async () => {
    render(<CollaboratorsPanel noteId="note-1" />)
    await waitFor(() => expect(aclAPI.get).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '刷新邀请与协作者状态' }))

    await waitFor(() => expect(aclAPI.get).toHaveBeenCalledTimes(2))
  })
})
