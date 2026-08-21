import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NotFoundException } from '@nestjs/common'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { NotesService } from '../src/modules/notes/notes.service'

const OWNER_ID = new Types.ObjectId()
const EDITOR_ID = new Types.ObjectId()
const VIEWER_ID = new Types.ObjectId()
const STRANGER_ID = new Types.ObjectId()
const NOTE_ID = new Types.ObjectId()

const JWT_SECRET = 'test-secret'

function makeJwtService(secret: string) {
  const jwt = require('jsonwebtoken')
  return {
    sign(payload: any, options?: any) {
      return jwt.sign(payload, secret, options)
    },
  }
}

function makeNoteModel(note: any | null) {
  return {
    findOne() {
      return {
        select() { return this },
        lean() { return this },
        async exec() { return note },
      }
    },
  }
}

function makeNote(overrides: Partial<{ userId: any; acl: any[]; visibility: string }> = {}) {
  return {
    _id: NOTE_ID,
    userId: overrides.userId ?? OWNER_ID,
    acl: overrides.acl ?? [],
    visibility: overrides.visibility ?? 'private',
  }
}

function makeService(note: any | null) {
  const noteModel = makeNoteModel(note) as any
  const cats = { assertOwnedIds: async () => {} } as any
  const tags = { assertOwnedIds: async () => {} } as any
  const embed = { upsert: async () => {} } as any
  const ai = {} as any
  const noteAccess = new NoteAccessService()
  const counter = { incrementForCreate: async () => {} } as any
  const cache = { get: async () => null, set: async () => {}, invalidate: async () => {} } as any
  const jwtService = makeJwtService(JWT_SECRET) as any
  return new NotesService(noteModel, cats, tags, embed, ai, noteAccess, counter, cache, { record: async () => undefined } as any, { findById: async () => null } as any, undefined, undefined, jwtService)
}

test('generateRoomTicket: owner receives writer role', async () => {
  const note = makeNote({ userId: OWNER_ID })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(OWNER_ID))
  assert.equal(result.role, 'writer')
  assert.equal(result.expiresIn, 300)
  assert.ok(result.ticket, 'ticket should be non-empty')
})

test('generateRoomTicket: ACL editor receives writer role', async () => {
  const note = makeNote({
    userId: OWNER_ID,
    acl: [{ userId: EDITOR_ID, role: 'editor' }],
  })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(EDITOR_ID))
  assert.equal(result.role, 'writer')
})

test('generateRoomTicket: ACL viewer receives reader role', async () => {
  const note = makeNote({
    userId: OWNER_ID,
    acl: [{ userId: VIEWER_ID, role: 'viewer' }],
  })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(VIEWER_ID))
  assert.equal(result.role, 'reader')
})

test('generateRoomTicket: public note stranger receives reader role', async () => {
  const note = makeNote({ userId: OWNER_ID, visibility: 'public' })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(STRANGER_ID))
  assert.equal(result.role, 'reader')
})

test('generateRoomTicket: no-access note throws NotFoundException', async () => {
  const svc = makeService(null)
  await assert.rejects(
    () => svc.generateRoomTicket(String(NOTE_ID), String(STRANGER_ID)),
    (err: any) => err instanceof NotFoundException || err.name === 'NotFoundException',
  )
})

test('generateRoomTicket: ticket decodes with correct claims', async () => {
  const jwt = require('jsonwebtoken')
  const note = makeNote({ userId: OWNER_ID })
  const svc = makeService(note)
  const result = await svc.generateRoomTicket(String(NOTE_ID), String(OWNER_ID))
  const payload = jwt.verify(result.ticket, JWT_SECRET) as any
  assert.equal(payload.noteId, String(NOTE_ID))
  assert.equal(payload.userId, String(OWNER_ID))
  assert.equal(payload.role, 'writer')
  assert.equal(payload.type, 'room-ticket')
})
