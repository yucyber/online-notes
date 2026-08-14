import { setCurrentUser, getCurrentUser, AUTH_CHANGED_EVENT } from '@/lib/auth'

describe('profile session sync', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('replaces the cached current user and notifies existing UI consumers', () => {
    const listener = jest.fn()
    window.addEventListener(AUTH_CHANGED_EVENT, listener)
    const user = {
      id: 'user-1',
      email: 'user@example.com',
      displayName: '林默',
      createdAt: '2026-08-14',
      updatedAt: '2026-08-14',
    }

    setCurrentUser(user)

    expect(getCurrentUser()).toEqual(user)
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(AUTH_CHANGED_EVENT, listener)
  })
})
