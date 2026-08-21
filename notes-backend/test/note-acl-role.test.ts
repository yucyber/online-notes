import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { NotesService } from '../src/modules/notes/notes.service'

const NOTE_ID = new Types.ObjectId()
const OWNER_ID = new Types.ObjectId()
const PSEUDO_OWNER_ID = new Types.ObjectId() // 曾通过 ACL owner 角色获得 owner 权限的用户
const EDITOR_ID = new Types.ObjectId()
const TARGET_ID = new Types.ObjectId()

// 构造带 equals/save 的 mongoose-like 文档
function makeDoc(seed: { userId: any; acl?: any[]; visibility?: string }) {
  return {
    _id: NOTE_ID,
    userId: seed.userId,
    visibility: seed.visibility ?? 'private',
    acl: seed.acl ?? [],
    equals(other: any) {
      return String(this.userId) === String(other)
    },
    save: async function save() { return this },
  }
}

function makeNoteModel(doc: any | null) {
  return {
    findById: () => ({ exec: async () => doc }),
    findOne: () => ({
      populate: () => ({ populate: () => ({ lean: () => ({ exec: async () => doc }) }) }),
      select: () => ({ lean: () => ({ exec: async () => doc }) }),
      exec: async () => doc,
    }),
  }
}

function makeService(note: any | null) {
  const noteModel = makeNoteModel(note) as any
  const cats = { assertOwnedIds: async () => {} } as any
  const tags = { assertOwnedIds: async () => {} } as any
  const embed = {} as any
  const ai = {} as any
  const noteAccess = new NoteAccessService()
  const counter = {} as any
  const cache = {} as any
  const jwt = require('jsonwebtoken')
  const jwtService = { sign: (p: any, o: any) => jwt.sign(p, 'test-secret', o) } as any
  return new NotesService(noteModel, cats, tags, embed, ai, noteAccess, counter, cache, { record: async () => undefined } as any, { findById: async () => null } as any, undefined, undefined, jwtService)
}

// 删除 ACL owner 角色后，owner 权限只能由 note.userId（创建者）持有。
// 以下测试锁定：曾以 ACL owner 角色存在的用户不再被当作所有者。

test('getAcl: canManage is true only for the creator (not ACL owner role)', async () => {
  const note = makeDoc({ userId: OWNER_ID, acl: [{ userId: PSEUDO_OWNER_ID, role: 'owner' }] })
  const svc = makeService(note)
  const result = await svc.getAcl(String(NOTE_ID), String(PSEUDO_OWNER_ID))
  assert.equal(result.canManage, false)
})

test('updateCollaboratorRole: ACL owner role does not grant owner rights', async () => {
  const note = makeDoc({ userId: OWNER_ID, acl: [{ userId: PSEUDO_OWNER_ID, role: 'owner' }, { userId: TARGET_ID, role: 'viewer' }] })
  const svc = makeService(note)
  await assert.rejects(
    () => svc.updateCollaboratorRole(String(NOTE_ID), String(PSEUDO_OWNER_ID), String(TARGET_ID), 'editor'),
    (err: any) => err?.name === 'NotFoundException',
  )
})

test('removeCollaborator: ACL owner role does not grant owner rights', async () => {
  const note = makeDoc({ userId: OWNER_ID, acl: [{ userId: PSEUDO_OWNER_ID, role: 'owner' }, { userId: TARGET_ID, role: 'viewer' }] })
  const svc = makeService(note)
  await assert.rejects(
    () => svc.removeCollaborator(String(NOTE_ID), String(PSEUDO_OWNER_ID), String(TARGET_ID)),
    (err: any) => err?.name === 'NotFoundException',
  )
})

test('generateRoomTicket: ACL owner role is demoted to reader', async () => {
  const note = makeDoc({ userId: OWNER_ID, acl: [{ userId: PSEUDO_OWNER_ID, role: 'owner' }] })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(PSEUDO_OWNER_ID))
  assert.equal(result.role, 'reader')
})

test('generateRoomTicket: ACL editor still receives writer', async () => {
  const note = makeDoc({ userId: OWNER_ID, acl: [{ userId: EDITOR_ID, role: 'editor' }] })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(EDITOR_ID))
  assert.equal(result.role, 'writer')
})
