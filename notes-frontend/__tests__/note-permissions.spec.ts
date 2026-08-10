import { canWriteNote, shouldManageNoteLock } from '@/components/editor/note-permissions'

describe('note editor permissions', () => {
  test('viewer cannot write while owner and editor can', () => {
    const note = {
      userId: 'owner',
      acl: [
        { userId: 'editor', role: 'editor' },
        { userId: 'viewer', role: 'viewer' },
      ],
    }

    expect(canWriteNote(note, 'owner')).toBe(true)
    expect(canWriteNote(note, 'editor')).toBe(true)
    expect(canWriteNote(note, 'viewer')).toBe(false)
    expect(canWriteNote(note, 'stranger')).toBe(false)
  })

  test('viewer does not manage write locks', () => {
    const note = { userId: 'owner', acl: [{ userId: 'viewer', role: 'viewer' }] }

    expect(shouldManageNoteLock(note, 'viewer')).toBe(false)
    expect(shouldManageNoteLock(note, 'owner')).toBe(true)
  })
})
