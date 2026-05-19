# Stability Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the first-stage stability and maintainability issues approved in `docs/superpowers/specs/2026-05-19-stability-refactor-design.md`.

**Architecture:** Apply risk-first changes: WebSocket auth consistency, Board/Mindmap ownership boundaries, API contract drift tracking, then `NotesService` decomposition. Keep public controllers, API envelope, and frontend API names stable.

**Tech Stack:** Next.js App Router, React 18, Jest/ts-jest, NestJS 10, Mongoose, Redis, Yjs/y-websocket, Node built-in test runner with `ts-node/register`.

---

## File Map

- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
  - Add token-aware WebsocketProvider creation and stable auth/degradation status.
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
  - Add tests for provider params, missing token, missing URL, and cleanup.
- Modify: `notes-backend/package.json`
  - Add a minimal `test:unit` script using Node test runner and existing `ts-node`.
- Create: `notes-backend/test/boards-mindmaps-access.test.ts`
  - Cover owner access, cross-user denial, invalid IDs, and create collision behavior for Board/Mindmap services.
- Modify: `notes-backend/src/modules/boards/boards.controller.ts`
- Modify: `notes-backend/src/modules/boards/boards.service.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.service.ts`
  - Pass user ID into get/update and enforce `_id + userId` queries.
- Modify: `notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
  - Do not auto-create on 401/403; only auto-create on confirmed 404.
- Create: `docs/api-contract-drift.md`
  - Human-readable contract drift register.
- Create: `scripts/check-api-contract.mjs`
  - Lightweight validation that each contract drift row has a decision.
- Modify: `package.json`
  - Add `check:api-contract`.
- Create: `notes-backend/src/modules/notes/note-access.service.ts`
  - Centralize ObjectId parsing and note access query builders.
- Create: `notes-backend/src/modules/notes/note-counter.service.ts`
  - Centralize category/tag count deltas.
- Modify: `notes-backend/src/modules/notes/notes.module.ts`
  - Provide new services.
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
  - Delegate access and counter behavior to focused services.
- Create: `notes-backend/test/note-access-counter.test.ts`
  - Unit coverage for access helpers and counter deltas.

## Task 1: Add Backend Unit Test Runner

**Files:**
- Modify: `notes-backend/package.json`

- [ ] **Step 1: Add unit test script**

In `notes-backend/package.json`, update `scripts` to include:

```json
{
  "build": "tsc",
  "start": "node dist/main.js",
  "dev": "nodemon",
  "start:prod": "node dist/main.js",
  "test:unit": "node --test -r ts-node/register -r tsconfig-paths/register test/**/*.test.ts"
}
```

- [ ] **Step 2: Run empty backend test command**

Run:

```bash
cd notes-backend
npm run test:unit
```

Expected: command exits `0` if no tests are discovered, or reports no matching test files. If Node returns an error for no files, continue after creating the first test in Task 3.

- [ ] **Step 3: Commit test runner**

```bash
git add notes-backend/package.json
git commit -m "test: add backend unit test runner"
```

## Task 2: Fix WebSocket Collaboration Auth

**Files:**
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

- [ ] **Step 1: Write failing tests for provider token behavior**

Append these tests to `notes-frontend/__tests__/editor.tiptap.spec.tsx`:

```tsx
jest.mock('y-websocket', () => {
  const providerInstances: any[] = []
  class WebsocketProvider {
    static instances = providerInstances
    awareness = {
      clientID: 1,
      setLocalStateField: jest.fn(),
      getStates: jest.fn(() => new Map()),
      on: jest.fn(),
      off: jest.fn(),
    }
    on = jest.fn()
    off = jest.fn()
    destroy = jest.fn()
    wsconnected = false
    wsconnecting = false
    synced = false
    constructor(public url: string, public room: string, public doc: any, public options: any) {
      providerInstances.push(this)
    }
  }
  return { WebsocketProvider }
})

jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve()
    destroy = jest.fn()
  },
}))

describe('TiptapEditor collaboration auth', () => {
  const user = { id: 'u1', name: 'User One' }

  beforeEach(() => {
    jest.resetModules()
    localStorage.clear()
    process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
  })

  test('passes access_token to WebsocketProvider when token exists', async () => {
    localStorage.setItem('notes_token', 'jwt-token')
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect((WebsocketProvider as any).instances[0].options.params.access_token).toBe('jwt-token')
  })

  test('does not create provider when token is missing', async () => {
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect((WebsocketProvider as any).instances).toHaveLength(0)
    expect(screen.getByText(/本地/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd notes-frontend
npm test -- __tests__/editor.tiptap.spec.tsx --runInBand
```

Expected: at least one new test fails because `TiptapEditor` does not pass `params.access_token`.

- [ ] **Step 3: Import token helpers**

In `notes-frontend/src/components/editor/TiptapEditor.tsx`, add:

```tsx
import { getToken, getTokenExpiration } from '@/lib/auth'
```

- [ ] **Step 4: Extend connection status type**

Replace:

```tsx
const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
```

With:

```tsx
type CollabStatus = 'config-missing' | 'auth-missing' | 'auth-expired' | 'auth-failed' | 'connecting' | 'connected' | 'disconnected'
const [connStatus, setConnStatus] = useState<CollabStatus>('connecting')
```

- [ ] **Step 5: Guard provider creation with token checks**

Inside the WebSocket `useEffect`, before `let p: WebsocketProvider | null = null`, insert:

```tsx
const token = getToken()
const expiresAt = token ? getTokenExpiration(token) : null

if (!token) {
  setLocalMode(true)
  setCollabEnabled(false)
  setProvider(null)
  setConnStatus('auth-missing')
  return
}

if (expiresAt && expiresAt <= Date.now()) {
  setLocalMode(true)
  setCollabEnabled(false)
  setProvider(null)
  setConnStatus('auth-expired')
  return
}
```

Also change the missing URL branch to:

```tsx
setConnStatus('config-missing')
```

- [ ] **Step 6: Pass token params to WebsocketProvider**

Replace the provider construction with:

```tsx
p = new WebsocketProvider(yws, room, ydoc, {
  connect: true,
  maxBackoffTime: 10000,
  disableBc: true,
  params: { access_token: token },
})
```

- [ ] **Step 7: Mark auth failure on WebSocket close/error**

In `connection-close` handler, add:

```tsx
if (e?.code === 1008 || e?.code === 4401 || String(e?.reason || '').includes('401')) {
  setConnStatus('auth-failed')
  setLocalMode(true)
  setCollabEnabled(false)
}
```

In `connection-error` handler, add:

```tsx
if (String(e?.message || e || '').includes('401')) {
  setConnStatus('auth-failed')
  setLocalMode(true)
  setCollabEnabled(false)
}
```

- [ ] **Step 8: Run focused frontend test**

Run:

```bash
cd notes-frontend
npm test -- __tests__/editor.tiptap.spec.tsx --runInBand
```

Expected: all tests in `editor.tiptap.spec.tsx` pass.

- [ ] **Step 9: Commit collaboration auth fix**

```bash
git add notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "fix: pass auth token to collaboration websocket"
```

## Task 3: Enforce Board/Mindmap Ownership

**Files:**
- Create: `notes-backend/test/boards-mindmaps-access.test.ts`
- Modify: `notes-backend/src/modules/boards/boards.controller.ts`
- Modify: `notes-backend/src/modules/boards/boards.service.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.service.ts`
- Modify: `notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`

- [ ] **Step 1: Write failing backend ownership tests**

Create `notes-backend/test/boards-mindmaps-access.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { Types } from 'mongoose'
import { BoardsService } from '../src/modules/boards/boards.service'
import { MindmapsService } from '../src/modules/mindmaps/mindmaps.service'

function createModel(seed: any[] = []) {
  const rows = [...seed]
  return {
    async create(data: any) {
      const doc = { _id: data._id || new Types.ObjectId(), id: String(data._id || new Types.ObjectId()), ...data }
      rows.push(doc)
      return doc
    },
    findOne(query: any) {
      return {
        lean: () => ({
          exec: async () => rows.find(row =>
            String(row._id) === String(query._id) &&
            String(row.userId) === String(query.userId)
          ) || null,
        }),
      }
    },
    findOneAndUpdate(query: any, update: any) {
      return {
        lean: () => ({
          exec: async () => {
            const row = rows.find(item =>
              String(item._id) === String(query._id) &&
              String(item.userId) === String(query.userId)
            )
            if (!row) return null
            Object.assign(row, update)
            return row
          },
        }),
      }
    },
  }
}

test('boards service denies cross-user read', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const service = new BoardsService(createModel([{ _id: boardId, userId: ownerId, title: 'A', content: {} }]) as any)

  await assert.rejects(() => service.getById(String(boardId), String(otherId)), /Board not found/)
})

test('mindmaps service denies cross-user update', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(createModel([{ _id: mapId, userId: ownerId, title: 'M', content: {} }]) as any)

  await assert.rejects(() => service.update(String(mapId), String(otherId), { title: 'Changed' }), /Mindmap not found/)
})
```

- [ ] **Step 2: Run backend tests to verify failure**

Run:

```bash
cd notes-backend
npm run test:unit
```

Expected: TypeScript or runtime failure because `getById` and `update` do not accept `userId` yet.

- [ ] **Step 3: Update Board service signatures and ID validation**

In `notes-backend/src/modules/boards/boards.service.ts`, replace `getById` and `update` with:

```ts
private parseObjectId(id: string, label: string) {
  if (!Types.ObjectId.isValid(id)) {
    const { BadRequestException } = require('@nestjs/common')
    throw new BadRequestException(`${label} is invalid`)
  }
  return new Types.ObjectId(id)
}

async getById(id: string, userId: string) {
  const doc = await this.model.findOne({
    _id: this.parseObjectId(id, 'Board id'),
    userId: this.parseObjectId(userId, 'User id'),
  }).lean().exec()
  if (!doc) throw new NotFoundException('Board not found')
  return {
    id: String((doc as any).id || (doc as any)?._id),
    title: String((doc as any).title || ''),
    content: (doc as any).content,
  }
}

async update(id: string, userId: string, input: { title?: string; content?: any }) {
  const updateData: any = {}
  if (input.title !== undefined) updateData.title = input.title
  if (input.content !== undefined) updateData.content = input.content

  const doc = await this.model.findOneAndUpdate(
    {
      _id: this.parseObjectId(id, 'Board id'),
      userId: this.parseObjectId(userId, 'User id'),
    },
    updateData,
    { new: true },
  ).lean().exec()
  if (!doc) throw new NotFoundException('Board not found')
  return {
    id: String((doc as any).id || (doc as any)?._id),
    title: String((doc as any).title || ''),
    content: (doc as any).content,
  }
}
```

- [ ] **Step 4: Update Mindmap service signatures and ID validation**

Apply the same pattern in `notes-backend/src/modules/mindmaps/mindmaps.service.ts`, using messages `Mindmap id is invalid` and `Mindmap not found`.

- [ ] **Step 5: Pass user ID from controllers**

In `boards.controller.ts`, replace:

```ts
async get(@Param('id') id: string) {
  return await this.svc.getById(id)
}

@Put(':id')
async update(@Param('id') id: string, @Body() payload: { title?: string; content?: any }) {
  return await this.svc.update(id, payload)
}
```

With:

```ts
async get(@Param('id') id: string, @Req() req: any) {
  return await this.svc.getById(id, req.user.id)
}

@Put(':id')
async update(@Param('id') id: string, @Req() req: any, @Body() payload: { title?: string; content?: any }) {
  return await this.svc.update(id, req.user.id, payload)
}
```

Repeat the same controller pattern in `mindmaps.controller.ts`.

- [ ] **Step 6: Prevent frontend auto-create on permission errors**

In both `dashboard/boards/[id]/page.tsx` and `dashboard/mindmaps/[id]/page.tsx`, replace the catch branch with:

```tsx
const status = e.response?.status
if (status === 404) {
  try {
    const created = await createBoard({ _id: id, title: '未命名画板' })
    setBoard(created)
    setError('')
  } catch {
    setError('创建画板失败')
  }
} else if (status === 401 || status === 403) {
  setError('无权限访问该画板')
} else {
  setError('加载画板失败')
}
```

For Mindmap, use `createMindMap`, `setMap`, and messages `未命名思维导图` / `无权限访问该思维导图` / `加载思维导图失败`.

- [ ] **Step 7: Run backend test and build**

Run:

```bash
cd notes-backend
npm run test:unit
npm run build
```

Expected: tests pass and TypeScript build exits `0`.

- [ ] **Step 8: Commit Board/Mindmap permission fix**

```bash
git add notes-backend/test/boards-mindmaps-access.test.ts notes-backend/src/modules/boards notes-backend/src/modules/mindmaps notes-frontend/src/app/dashboard/boards/[id]/page.tsx notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx
git commit -m "fix: enforce board and mindmap ownership"
```

## Task 4: Add API Contract Drift Register

**Files:**
- Create: `docs/api-contract-drift.md`
- Create: `scripts/check-api-contract.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create contract drift register**

Create `docs/api-contract-drift.md`:

```markdown
# API Contract Drift Register

| Path | Consumer | Backend status | OpenAPI status | Decision | Verification |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/assets/base64` | `notes-frontend/src/lib/api.ts` `assetsAPI.uploadBase64` | missing | missing | `hide-client-entry` | Attachment UI shows an explicit unavailable message. |
| `/api/v1/assets/:id` | `notes-frontend/src/lib/api.ts` `assetsAPI.getById` | missing | missing | `hide-client-entry` | Direct asset loading is not advertised as available. |
| `/api/v1/embeds` | `notes-frontend/src/lib/api.ts` `embedsAPI.create` | missing | missing | `hide-client-entry` | Embed creation path reports unavailable instead of silent failure. |
| `/api/v1/drafts/auto-save` | OpenAPI only | missing | present | `mark-planned-or-remove` | OpenAPI marks endpoint as planned or removes it from current contract. |
| `/api/v1/drafts/sync` | OpenAPI only | missing | present | `mark-planned-or-remove` | OpenAPI marks endpoint as planned or removes it from current contract. |
| `/api/v1/vector/upsert` | OpenAPI only | missing | present | `mark-planned-or-remove` | OpenAPI marks endpoint as planned or removes it from current contract. |
| `/api/v1/vector/batch-upsert` | OpenAPI only | missing | present | `mark-planned-or-remove` | OpenAPI marks endpoint as planned or removes it from current contract. |
| `/api/v1/network/status` | OpenAPI only | missing | present | `mark-planned-or-remove` | OpenAPI marks endpoint as planned or removes it from current contract. |
| `/api/v1/network/diagnostics` | OpenAPI only | missing | present | `mark-planned-or-remove` | OpenAPI marks endpoint as planned or removes it from current contract. |
| `/api/v1/boards/:id` | Board pages and resource embeds | present | missing | `implement-now` | Ownership tests pass and OpenAPI entry is added or register remains as accepted drift. |
| `/api/v1/mindmaps/:id` | Mindmap pages and resource embeds | present | missing | `implement-now` | Ownership tests pass and OpenAPI entry is added or register remains as accepted drift. |
| `/api/v1/semantic/*` | Dashboard topics and semantic search | present | partial | `implement-now` | Semantic controller behavior is covered by later semantic-specific tests. |
```

- [ ] **Step 2: Create lightweight register checker**

Create `scripts/check-api-contract.mjs`:

```js
import { readFileSync } from 'node:fs'

const file = 'docs/api-contract-drift.md'
const text = readFileSync(file, 'utf8')
const rows = text.split('\n').filter(line => line.startsWith('| `/api/'))
const allowed = new Set(['implement-now', 'hide-client-entry', 'mark-planned-or-remove'])

let failures = 0
for (const row of rows) {
  const cells = row.split('|').map(cell => cell.trim()).filter(Boolean)
  const path = cells[0]
  const decision = cells[4]?.replace(/`/g, '')
  const verification = cells[5]
  if (!allowed.has(decision)) {
    console.error(`Invalid decision for ${path}: ${decision}`)
    failures++
  }
  if (!verification || verification.length < 8) {
    console.error(`Missing verification for ${path}`)
    failures++
  }
}

if (rows.length < 10) {
  console.error(`Expected at least 10 drift rows, found ${rows.length}`)
  failures++
}

if (failures > 0) process.exit(1)
console.log(`API contract drift register OK: ${rows.length} rows`)
```

- [ ] **Step 3: Add root script**

In root `package.json`, add:

```json
{
  "scripts": {
    "check:api-contract": "node scripts/check-api-contract.mjs"
  },
  "devDependencies": {
    "ts-node": "^10.9.2"
  },
  "dependencies": {
    "@types/ws": "^8.18.1",
    "ws": "^8.18.3",
    "y-websocket": "^3.0.0",
    "yjs": "^13.6.28"
  }
}
```

- [ ] **Step 4: Run contract check**

Run:

```bash
npm run check:api-contract
```

Expected: `API contract drift register OK: 12 rows`.

- [ ] **Step 5: Commit contract register**

```bash
git add docs/api-contract-drift.md scripts/check-api-contract.mjs package.json
git commit -m "docs: add api contract drift register"
```

## Task 5: Split Note Access and Counter Responsibilities

**Files:**
- Create: `notes-backend/src/modules/notes/note-access.service.ts`
- Create: `notes-backend/src/modules/notes/note-counter.service.ts`
- Create: `notes-backend/test/note-access-counter.test.ts`
- Modify: `notes-backend/src/modules/notes/notes.module.ts`
- Modify: `notes-backend/src/modules/notes/notes.service.ts`

- [ ] **Step 1: Write failing access and counter tests**

Create `notes-backend/test/note-access-counter.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { Types } from 'mongoose'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { NoteCounterService } from '../src/modules/notes/note-counter.service'

test('note access parses valid object ids and rejects invalid ids', () => {
  const service = new NoteAccessService()
  const id = new Types.ObjectId()
  assert.equal(String(service.objectId(String(id), 'note id')), String(id))
  assert.throws(() => service.objectId('bad-id', 'note id'), /note id is invalid/)
})

test('note access builds editor write scope', () => {
  const service = new NoteAccessService()
  const noteId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const query = service.writeScope(String(noteId), String(userId))
  assert.deepEqual(query.$or[1].acl.$elemMatch.role.$in, ['owner', 'editor'])
})

test('note counter computes category and tag deltas', () => {
  const service = new NoteCounterService({} as any, {} as any)
  assert.deepEqual(service.diffIds(['a', 'b'], ['b', 'c']), { add: ['c'], remove: ['a'] })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd notes-backend
npm run test:unit
```

Expected: module-not-found errors for `note-access.service` and `note-counter.service`.

- [ ] **Step 3: Create NoteAccessService**

Create `notes-backend/src/modules/notes/note-access.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common'
import { Types } from 'mongoose'

@Injectable()
export class NoteAccessService {
  objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} is invalid`)
    return new Types.ObjectId(id)
  }

  readScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId } } },
        { visibility: 'public' },
      ],
    }
  }

  writeScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId, role: { $in: ['owner', 'editor'] } } } },
      ],
    }
  }

  ownerScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId, role: 'owner' } } },
      ],
    }
  }
}
```

- [ ] **Step 4: Create NoteCounterService**

Create `notes-backend/src/modules/notes/note-counter.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { CategoriesService } from '../categories/categories.service'
import { TagsService } from '../tags/tags.service'

@Injectable()
export class NoteCounterService {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
  ) {}

  diffIds(prev: string[], next: string[]) {
    const prevSet = new Set(prev.filter(Boolean))
    const nextSet = new Set(next.filter(Boolean))
    return {
      add: [...nextSet].filter(id => !prevSet.has(id)),
      remove: [...prevSet].filter(id => !nextSet.has(id)),
    }
  }

  async incrementForCreate(input: { categoryId?: string; categoryIds?: string[]; tags?: string[] }) {
    const categoryIds = new Set<string>()
    if (input.categoryId) categoryIds.add(input.categoryId)
    for (const id of input.categoryIds || []) categoryIds.add(id)
    await Promise.all([...categoryIds].map(id => this.categoriesService.incrementNoteCount(id)))
    await Promise.all((input.tags || []).map(id => this.tagsService.incrementNoteCount(id)))
  }

  async updateCategories(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    await Promise.all([
      ...delta.add.map(id => this.categoriesService.incrementNoteCount(id)),
      ...delta.remove.map(id => this.categoriesService.decrementNoteCount(id)),
    ])
  }

  async updateTags(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    await Promise.all([
      ...delta.add.map(id => this.tagsService.incrementNoteCount(id)),
      ...delta.remove.map(id => this.tagsService.decrementNoteCount(id)),
    ])
  }

  async decrementForDelete(input: { categoryId?: string; categoryIds?: string[]; tags?: string[] }) {
    const categoryIds = new Set<string>()
    if (input.categoryId) categoryIds.add(input.categoryId)
    for (const id of input.categoryIds || []) categoryIds.add(id)
    await Promise.all([...categoryIds].map(id => this.categoriesService.decrementNoteCount(id)))
    await Promise.all((input.tags || []).map(id => this.tagsService.decrementNoteCount(id)))
  }
}
```

- [ ] **Step 5: Register services in NotesModule**

In `notes-backend/src/modules/notes/notes.module.ts`, add providers:

```ts
providers: [NotesService, NoteAccessService, NoteCounterService],
exports: [NotesService, NoteAccessService, NoteCounterService],
```

and imports:

```ts
import { NoteAccessService } from './note-access.service'
import { NoteCounterService } from './note-counter.service'
```

- [ ] **Step 6: Inject services into NotesService**

In `notes.service.ts`, import:

```ts
import { NoteAccessService } from './note-access.service'
import { NoteCounterService } from './note-counter.service'
```

Add constructor parameters:

```ts
private readonly noteAccess: NoteAccessService,
private readonly noteCounter: NoteCounterService,
```

- [ ] **Step 7: Replace create counter side effects**

In `create`, replace the category/tag count loops with:

```ts
await this.noteCounter.incrementForCreate({
  categoryId: createNoteDto.categoryId,
  categoryIds: createNoteDto.categoryIds,
  tags: createNoteDto.tags,
})
```

- [ ] **Step 8: Replace findOne scope**

In `findOne`, replace the manual query with:

```ts
const note = await this.noteModel
  .findOne(this.noteAccess.readScope(id, userId))
  .populate('categoryId', 'name')
  .populate('tags', 'name')
  .exec()
```

- [ ] **Step 9: Replace update scope and counter updates**

In `update`, replace the original lookup query with:

```ts
const originalNote = await this.noteModel.findOne(this.noteAccess.writeScope(id, userId)).exec()
```

After successful update, replace category/tag count logic with:

```ts
if (updateNoteDto.categoryId && updateNoteDto.categoryId !== originalNote.categoryId?.toString()) {
  await this.noteCounter.updateCategories(
    originalNote.categoryId ? [originalNote.categoryId.toString()] : [],
    [updateNoteDto.categoryId],
  )
}

if (Array.isArray(updateNoteDto.categoryIds)) {
  await this.noteCounter.updateCategories(
    (originalNote.categoryIds || []).map(id => id.toString()),
    updateNoteDto.categoryIds,
  )
}

if (Array.isArray(updateNoteDto.tags)) {
  await this.noteCounter.updateTags(
    (originalNote.tags || []).map(id => id.toString()),
    updateNoteDto.tags,
  )
}
```

- [ ] **Step 10: Replace remove permission and delete behavior**

In `remove`, replace the original note lookup with:

```ts
const note = await this.noteModel.findOne(this.noteAccess.ownerScope(id, userId)).exec()
```

Replace `deleteOne` query with:

```ts
const result = await this.noteModel.deleteOne({ _id: this.noteAccess.objectId(id, 'note id') }).exec()
```

Replace decrement loops with:

```ts
await this.noteCounter.decrementForDelete({
  categoryId: note.categoryId?.toString(),
  categoryIds: (note.categoryIds || []).map(cid => cid.toString()),
  tags: (note.tags || []).map(tagId => tagId.toString()),
})
```

- [ ] **Step 11: Run backend tests and build**

Run:

```bash
cd notes-backend
npm run test:unit
npm run build
```

Expected: unit tests pass and build exits `0`.

- [ ] **Step 12: Commit NotesService split**

```bash
git add notes-backend/src/modules/notes notes-backend/test/note-access-counter.test.ts
git commit -m "refactor: split note access and counters"
```

## Task 6: Final Verification

**Files:**
- Read-only verification across project.

- [ ] **Step 1: Run frontend verification**

```bash
cd notes-frontend
npm run type-check
npm run lint
npm test -- __tests__/editor.tiptap.spec.tsx __tests__/search.console.spec.tsx --runInBand
```

Expected: all commands exit `0`. If coverage thresholds make the focused Jest run fail, run `npm run ci:test` and record the exact coverage result.

- [ ] **Step 2: Run backend verification**

```bash
cd notes-backend
npm run test:unit
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run contract check**

```bash
npm run check:api-contract
```

Expected: `API contract drift register OK: 12 rows`.

- [ ] **Step 4: Confirm Git state**

```bash
git status --short --branch
```

Expected: branch is ahead by implementation commits and no unstaged source changes remain.

- [ ] **Step 5: Final implementation commit if verification changed docs**

If verification required updating documentation, commit that documentation:

```bash
git add docs/api-contract-drift.md docs/superpowers/plans/2026-05-19-stability-refactor-implementation.md
git commit -m "docs: record stability refactor verification"
```

## Self-Review Checklist

- Spec coverage:
  - WebSocket auth: Task 2.
  - Board/Mindmap permission: Task 3.
  - API contract drift: Task 4.
  - NotesService split: Task 5.
  - Verification: Task 6.
- Project skills incorporated:
  - Hook extraction and component splitting inform Task 2.
  - React state categories prevent adding new global state.
  - Vercel rules guide primitive effect dependencies, stable event handlers, storage safety, async parallelism, and Set/Map deltas.
- Type consistency:
  - `NoteAccessService.objectId/readScope/writeScope/ownerScope` are defined before use.
  - `NoteCounterService.diffIds/incrementForCreate/updateCategories/updateTags/decrementForDelete` are defined before use.
  - Board/Mindmap `update(id, userId, input)` signature is used consistently.
