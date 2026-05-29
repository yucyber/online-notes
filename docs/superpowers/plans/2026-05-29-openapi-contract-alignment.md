# OpenAPI Contract Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `notes-backend/openapi.yaml` with the currently implemented backend and frontend API surface, while moving valuable future APIs to a planned registry and dropping low-value network-only drafts.

**Architecture:** Treat OpenAPI as the current executable contract only. Track long-term but unimplemented APIs in documentation outside `paths`, and teach the contract checker to ignore explicitly approved planned/discarded entries while still detecting accidental drift.

**Tech Stack:** Node.js script (`scripts/check-api-contract.mjs`), OpenAPI 3.0 YAML (`notes-backend/openapi.yaml`), Markdown registry (`docs/api-contract-drift.md`), Next.js API client (`notes-frontend/src/lib/api.ts`), NestJS controllers (`notes-backend/src/modules/**/*.controller.ts`).

---

## Current Context

Current working tree already has unrelated frontend test fixes:

- `notes-frontend/__tests__/editor.markdown.spec.tsx`
- `notes-frontend/__tests__/search.console.spec.tsx`

Do not stage or modify those files as part of this OpenAPI alignment unless the user explicitly folds that work into the same change.

The user approved this policy:

- Discard low-value OpenAPI-only APIs.
- Keep valuable but unimplemented APIs as planned, outside the executable OpenAPI `paths`.

## API Disposition

### Remove From Executable Contract And Mark Discarded

These have no controller, no frontend dependency, and are superseded by existing health/ping behavior:

- `/api/v1/network/status`
- `/api/v1/network/diagnostics`

Replacement:

- `/api/health`
- frontend fallback ping through `/api/notes?limit=1`

### Remove From Executable Contract And Mark Planned

These are valuable but not implemented yet:

- `/api/v1/drafts/auto-save`
- `/api/v1/drafts/sync`
- `/api/v1/vector/upsert`
- `/api/v1/vector/batch-upsert`

Planned location:

- `docs/api-contract-drift.md`, section `## Planned APIs`

### Keep In Executable Contract

Document all currently implemented and useful runtime routes in `notes-backend/openapi.yaml`:

- `/api/health`
- `/api/auth/register`
- `/api/auth/login`
- `/api/auth/me`
- `/api/notes`
- `/api/notes/{id}`
- `/api/notes/recommendations`
- `/api/notes/{id}/acl`
- `/api/notes/{id}/acl/{userId}`
- `/api/notes/{id}/lock`
- `/api/notes/{id}/comments`
- `/api/comments/{id}`
- `/api/comments/{id}/replies`
- `/api/notes/{id}/versions`
- `/api/notes/{id}/versions/{versionNo}/restore`
- `/api/categories`
- `/api/categories/{id}`
- `/api/tags`
- `/api/tags/{id}`
- `/api/tags/bulk`
- `/api/tags/merge`
- `/api/tags/sync`
- `/api/v1/boards`
- `/api/v1/boards/{id}`
- `/api/v1/mindmaps`
- `/api/v1/mindmaps/{id}`
- `/api/v1/semantic/search`
- `/api/v1/semantic/topics`
- `/api/v1/semantic/topics/convert`
- `/api/invitations/notes/{id}`
- `/api/invitations/mine`
- `/api/invitations/{token}`
- `/api/invitations/{token}/accept`
- `/api/saved-filters`
- `/api/saved-filters/{id}`
- `/api/dashboard/overview`
- `/api/audit/logs`
- `/api/notifications`
- `/api/notifications/{id}/read`
- `/api/rum/collect`
- `/api/rum/report`

### Keep As Frontend Feature-Unavailable Stubs, Not OpenAPI Paths

These remain frontend placeholders that throw `FeatureUnavailableError`; they are not executable backend contracts:

- `/api/v1/assets/base64`
- `/api/v1/assets/{id}`
- `/api/v1/embeds`

## Task 1: Add Planned/Discarded Registry Sections

**Files:**

- Modify: `docs/api-contract-drift.md`

- [ ] **Step 1: Add registry sections**

Add these sections below the decision policy paragraph and above the drift table:

```markdown
## Planned APIs

These APIs have product value but no current backend controller. They must not appear in `notes-backend/openapi.yaml` executable `paths` until implemented.

| Path | Reason | Re-entry condition |
| --- | --- | --- |
| `/api/v1/drafts/auto-save` | Server-side offline draft persistence is valuable for future multi-device editing, but current drafts are local-only. | Add NestJS drafts controller/service and frontend client call. |
| `/api/v1/drafts/sync` | Draft conflict/sync is valuable for future offline reconciliation, but current sync is not implemented. | Add sync conflict model, controller, service, and UI recovery flow. |
| `/api/v1/vector/upsert` | Single vector upsert may be useful for future index maintenance, but current embedding writes are internal. | Add secured vector controller or admin-only maintenance command. |
| `/api/v1/vector/batch-upsert` | Batch vector upsert may be useful for rebuild jobs, but current code has no public batch API. | Add explicit rebuild workflow and authorization boundary. |

## Discarded APIs

These APIs are intentionally removed from the current contract.

| Path | Reason | Replacement |
| --- | --- | --- |
| `/api/v1/network/status` | No backend controller or frontend dependency; duplicates lightweight connectivity checks. | `/api/health` and frontend fallback ping. |
| `/api/v1/network/diagnostics` | No backend controller or current product workflow; diagnostics would expose implementation details if added casually. | Operational logs and targeted health checks. |
```

- [ ] **Step 2: Update drift rows for planned/discarded entries**

Remove the six OpenAPI-only rows from the main drift table:

```markdown
| `/api/v1/drafts/auto-save` | ... |
| `/api/v1/drafts/sync` | ... |
| `/api/v1/network/diagnostics` | ... |
| `/api/v1/network/status` | ... |
| `/api/v1/vector/batch-upsert` | ... |
| `/api/v1/vector/upsert` | ... |
```

- [ ] **Step 3: Verify registry still parses**

Run:

```powershell
npm run check:api-contract
```

Expected at this intermediate point:

```text
Stale API contract drift registration
```

or another failure is acceptable here because `openapi.yaml` and the checker have not been updated yet. Do not stop unless the error is a Markdown parse/runtime error.

## Task 2: Update Contract Checker For Approved Planned/Discarded Paths

**Files:**

- Modify: `scripts/check-api-contract.mjs`

- [ ] **Step 1: Parse approved non-contract paths**

Add this function after `parseRegistry()`:

```js
function parseApprovedNonContractPaths() {
  const text = readFileSync(REGISTRY, 'utf8')
  const sections = ['## Planned APIs', '## Discarded APIs']
  const paths = new Set()

  for (const section of sections) {
    const start = text.indexOf(section)
    if (start === -1) continue
    const next = text.indexOf('\n## ', start + section.length)
    const body = text.slice(start, next === -1 ? text.length : next)
    const rows = body.split('\n').filter(line => line.startsWith('| `/api/'))
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim())
      const path = (cells[1] || '').replace(/`/g, '')
      if (path) paths.add(path)
    }
  }

  return paths
}
```

- [ ] **Step 2: Use approved paths in `main()`**

In `main()`, after `const registry = parseRegistry()`, add:

```js
  const approvedNonContractPaths = parseApprovedNonContractPaths()
```

Then change the unregistered drift loop to:

```js
  for (const path of drift) {
    if (!registry.has(path) && !approvedNonContractPaths.has(path)) {
      console.error(`Unregistered API contract drift: ${path}`)
      failures++
    }
  }
```

Then add this validation loop before the final failure check:

```js
  for (const path of approvedNonContractPaths) {
    if (registry.has(path)) {
      console.error(`Approved non-contract path is still in drift registry: ${path}`)
      failures++
    }
    if (!drift.includes(path)) {
      console.error(`Approved non-contract path no longer drifts and should be removed from planned/discarded registry: ${path}`)
      failures++
    }
  }
```

- [ ] **Step 3: Verify checker behavior before OpenAPI rewrite**

Run:

```powershell
npm run check:api-contract
```

Expected: still fails because most `document-openapi` rows are not yet documented.

## Task 3: Rewrite OpenAPI Metadata And Remove Non-Executable Paths

**Files:**

- Modify: `notes-backend/openapi.yaml`

- [ ] **Step 1: Update document identity**

Replace the `info` block with:

```yaml
info:
  title: 在线笔记平台 API
  version: 1.1.0
  description: |
    当前文档只描述已经实现并可调用的后端 HTTP API。
    - 统一响应包：`{ code, message, data, requestId, timestamp }`
    - 鉴权：`Authorization: Bearer <JWT>`
    - 写入类接口可按实现使用 `Idempotency-Key`
    - 未实现但有长期价值的接口记录在 `docs/api-contract-drift.md` 的 Planned APIs
```

- [ ] **Step 2: Replace tags with current product tags**

Use this tag list:

```yaml
tags:
  - name: Health
    description: 服务健康检查
  - name: Auth
    description: 注册、登录与当前用户
  - name: Notes
    description: 笔记 CRUD、搜索、推荐、ACL 与锁定
  - name: Comments
    description: 笔记评论与回复
  - name: Versions
    description: 笔记版本快照与恢复
  - name: Categories
    description: 分类管理
  - name: Tags
    description: 标签管理
  - name: Boards
    description: 画板资源
  - name: Mindmaps
    description: 思维导图资源
  - name: Semantic
    description: 语义搜索与主题聚类
  - name: Invitations
    description: 笔记邀请协作
  - name: SavedFilters
    description: 保存筛选器
  - name: Dashboard
    description: 仪表盘概览
  - name: Audit
    description: 审计日志
  - name: Notifications
    description: 通知中心
  - name: RUM
    description: 前端运行时指标采集
```

- [ ] **Step 3: Remove planned/discarded paths from executable `paths`**

Delete these full YAML path blocks:

```yaml
/api/v1/drafts/auto-save
/api/v1/drafts/sync
/api/v1/network/status
/api/v1/network/diagnostics
/api/v1/vector/upsert
/api/v1/vector/batch-upsert
```

Keep `/api/v1/semantic/search`; it is implemented by `notes-backend/src/modules/semantic/semantic.controller.ts`.

- [ ] **Step 4: Run OpenAPI syntax smoke check**

Run:

```powershell
node -e "const fs=require('fs'); const text=fs.readFileSync('notes-backend/openapi.yaml','utf8'); if(!text.includes('openapi: 3.0.3')) process.exit(1); console.log('openapi text readable')"
```

Expected:

```text
openapi text readable
```

## Task 4: Add Current Backend/Frontend Paths To OpenAPI

**Files:**

- Modify: `notes-backend/openapi.yaml`

- [ ] **Step 1: Add auth paths**

Add `/api/auth/register`, `/api/auth/login`, and `/api/auth/me` with:

- `POST /register`: body `{ email, password, name? }`, response `AuthSession`
- `POST /login`: body `{ email, password }`, response `AuthSession`
- `GET /me`: bearer auth, response `User`

- [ ] **Step 2: Add taxonomy paths**

Add:

- `/api/categories` with `GET`, `POST`
- `/api/categories/{id}` with `GET`, `PATCH`, `DELETE`
- `/api/tags` with `GET`, `POST`
- `/api/tags/{id}` with `GET`, `PATCH`, `DELETE`
- `/api/tags/bulk` with `POST`
- `/api/tags/merge` with `POST`
- `/api/tags/sync` with `POST`

Use shared schemas:

```yaml
Category:
  type: object
  properties:
    id: { type: string }
    _id: { type: string }
    name: { type: string }
    description: { type: string }
    color: { type: string }
    parentId: { type: string, nullable: true }
    noteCount: { type: integer }
Tag:
  type: object
  properties:
    id: { type: string }
    _id: { type: string }
    name: { type: string }
    color: { type: string }
    noteCount: { type: integer }
```

- [ ] **Step 3: Add notes companion paths**

Add:

- `/api/notes/{id}` with `GET`, `PATCH`, `PUT`, `DELETE`
- `/api/notes/recommendations` with `GET`
- `/api/notes/{id}/acl` with `GET`, `POST`
- `/api/notes/{id}/acl/{userId}` with `PATCH`, `DELETE`
- `/api/notes/{id}/lock` with `POST`, `DELETE`
- `/api/notes/{id}/comments` with `GET`, `POST`
- `/api/comments/{id}` with `DELETE`
- `/api/comments/{id}/replies` with `POST`
- `/api/notes/{id}/versions` with `GET`, `POST`
- `/api/notes/{id}/versions/{versionNo}/restore` with `POST`

- [ ] **Step 4: Add resource and workflow paths**

Add:

- `/api/v1/boards` with `POST`
- `/api/v1/boards/{id}` with `GET`, `PUT`
- `/api/v1/mindmaps` with `POST`
- `/api/v1/mindmaps/{id}` with `GET`, `PUT`
- `/api/v1/semantic/search` with `GET`
- `/api/v1/semantic/topics` with `GET`
- `/api/v1/semantic/topics/convert` with `POST`
- `/api/invitations/notes/{id}` with `GET`, `POST`
- `/api/invitations/mine` with `GET`
- `/api/invitations/{token}` with `GET`, `DELETE`
- `/api/invitations/{token}/accept` with `POST`
- `/api/saved-filters` with `GET`, `POST`
- `/api/saved-filters/{id}` with `DELETE`
- `/api/dashboard/overview` with `GET`
- `/api/audit/logs` with `GET`
- `/api/notifications` with `GET`
- `/api/notifications/{id}/read` with `PATCH`
- `/api/rum/collect` with `POST`
- `/api/rum/report` with `GET`

- [ ] **Step 5: Normalize path parameters**

Use OpenAPI `{name}` parameters, not drift notation `:id`.

Examples:

```yaml
/api/notes/{id}:
/api/notes/{id}/acl/{userId}:
/api/notes/{id}/versions/{versionNo}/restore:
```

## Task 5: Remove Resolved Drift Rows And Re-run Contract Check

**Files:**

- Modify: `docs/api-contract-drift.md`
- Verify: `scripts/check-api-contract.mjs`

- [ ] **Step 1: Run contract checker**

Run:

```powershell
npm run check:api-contract
```

Expected while iterating:

```text
Stale API contract drift registration: /api/...
```

For each stale row, confirm the path exists in `notes-backend/openapi.yaml`, then remove that row from the main drift table.

- [ ] **Step 2: Reach zero active drift**

Run:

```powershell
npm run check:api-contract
```

Expected:

```text
API contract drift register OK: 0 drift rows
```

If assets/embeds still produce drift because marker comments are counted, keep their three rows in the drift table with decision `hide-client-entry`. Expected output then becomes:

```text
API contract drift register OK: 3 drift rows
```

Do not add assets/embeds to executable OpenAPI unless backend controllers are implemented.

## Task 6: Final Verification

**Files:**

- Verify only

- [ ] **Step 1: Backend build**

Run:

```powershell
npm run build
```

Working directory:

```text
notes-backend
```

Expected: exit code 0.

- [ ] **Step 2: Frontend type-check**

Run:

```powershell
npx tsc --noEmit
```

Working directory:

```text
notes-frontend
```

Expected: exit code 0.

- [ ] **Step 3: Frontend Jest**

Run:

```powershell
npx jest --no-coverage --runInBand
```

Working directory:

```text
notes-frontend
```

Expected:

```text
Test Suites: 4 passed, 4 total
Tests:       9 passed, 9 total
```

- [ ] **Step 4: Contract checker**

Run:

```powershell
npm run check:api-contract
```

Working directory:

```text
repo root
```

Expected: active drift count is `0`, or `3` if assets/embeds feature-unavailable stubs remain counted as intentional drift.

- [ ] **Step 5: Review Git status**

Run:

```powershell
git status --short --branch
```

Expected OpenAPI-related modified files:

```text
 M docs/api-contract-drift.md
 M notes-backend/openapi.yaml
 M scripts/check-api-contract.mjs
```

Existing frontend test files may still be modified from the previous validation task; do not stage them with OpenAPI changes unless explicitly requested:

```text
 M notes-frontend/__tests__/editor.markdown.spec.tsx
 M notes-frontend/__tests__/search.console.spec.tsx
```

## Self-Review

- Spec coverage: The plan covers the approved disposition for discarded, planned, executable, and frontend-only unavailable APIs.
- Placeholder scan: No TBD/TODO placeholders are present.
- Type consistency: Planned paths use `/api/...`; OpenAPI path templates use `{id}`, `{userId}`, `{versionNo}`, and `{token}` consistently.
- Risk: The largest risk is hand-editing a large YAML file. Mitigation is incremental `npm run check:api-contract` after each path group.
