# AI Gateway Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented and verified on 2026-06-03.

**Goal:** Replace scattered Coze/Zhipu AI calls with one NestJS AI gateway backed by MiMo, SenseNova, and SiliconFlow.

**Architecture:** Add a backend AI gateway client inside `notes-backend/src/modules/ai` with typed methods for chat, streaming chat, embeddings, rerank, summary, mindmap, mermaid, and topic naming. Existing backend services call `AiService`; Next.js BFF routes become thin proxies to Nest endpoints, preserving current frontend response shapes while removing direct Coze/model-secret usage from the frontend server.

**Tech Stack:** NestJS, ConfigService, native fetch, Node streams, Next.js Route Handlers, node:test, TypeScript.

---

## Scope Correction

The user mentioned ModelArk in the requested sequence. The project was already switched to SiliconFlow because ModelArk live calls failed at the account/resource-package layer, while SiliconFlow live checks pass for:

- `Qwen/Qwen3-Embedding-8B`
- `Qwen/Qwen3-Reranker-8B`

Implementation must use `SILICONFLOW_*` variables and must not reintroduce `MODELARK_*` as active config.

## Files

- Create: `notes-backend/src/modules/ai/ai-gateway.types.ts`
  - Shared request/response types and provider names.
- Create: `notes-backend/src/modules/ai/ai-gateway.client.ts`
  - Low-level provider routing, OpenAI-compatible chat/stream/embedding calls, SiliconFlow rerank.
- Create: `notes-backend/src/modules/ai/ai.controller.ts`
  - Authenticated backend endpoints used by frontend BFF routes.
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
  - Replace Coze summary with gateway calls and expose domain methods.
- Modify: `notes-backend/src/modules/ai/ai.module.ts`
  - Register `AiGatewayClient` and `AiController`.
- Modify: `notes-backend/src/modules/semantic/embedding.service.ts`
  - Replace Zhipu JWT/embedding implementation with `AiService.generateEmbedding`.
- Modify: `notes-backend/src/modules/semantic/semantic.module.ts`
  - Import `AiModule`.
- Modify: `notes-backend/src/modules/semantic/semantic.service.ts`
  - Replace Coze topic naming with `AiService.generateTopicName`.
- Modify: `notes-frontend/src/app/api/ai/*.ts`
  - Replace direct Coze calls with backend proxy calls.
- Create: `notes-frontend/src/app/api/ai/_proxy.ts`
  - Shared backend URL, cookie auth forwarding, envelope unwrap, and text streaming proxy helpers.
- Create: `notes-backend/test/ai-gateway.test.ts`
  - Unit tests for routing, missing config, errors, embedding parsing, reranker parsing, and service fallbacks.
- Modify: `docs/superpowers/plans/2026-06-02-ai-config-hardening.md`
  - Append final migration note after implementation.

## Task 1: Backend AI Gateway Core

- [x] **Step 1: Add tests for provider routing and missing config**

Create `notes-backend/test/ai-gateway.test.ts` with fake config and fake fetch tests:

- text provider `sensenova` routes to `SENSENOVA_BASE_URL/chat/completions`.
- reasoning provider `mimo` routes to `MIMO_BASE_URL/chat/completions`.
- embedding provider `siliconflow` routes to `SILICONFLOW_BASE_URL/embeddings`.
- reranker provider uses `SILICONFLOW_BASE_URL/rerank`.
- missing provider config throws a clear error that does not include secret values.

Run:

```powershell
node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts
```

Expected: tests fail because `AiGatewayClient` does not exist yet.

- [x] **Step 2: Implement `ai-gateway.types.ts` and `ai-gateway.client.ts`**

Implementation requirements:

- Use native `fetch`, injected through constructor defaulting to `globalThis.fetch`.
- Mask no secrets in errors; never include API key values.
- Method signatures:
  - `chat(options: AiChatOptions): Promise<string>`
  - `streamChat(options: AiChatOptions): Promise<ReadableStream<Uint8Array>>`
  - `embedding(text: string): Promise<number[]>`
  - `rerank(query: string, documents: string[]): Promise<AiRerankResult[]>`
- `AiChatOptions.route` is `'text' | 'reasoning'`.
- `streamChat` reads OpenAI SSE and outputs plain text chunks.
- Provider models:
  - text: `SENSENOVA_TEXT_MODEL`
  - reasoning: `MIMO_MODEL`
  - embedding: `SILICONFLOW_EMBEDDING_MODEL`
  - reranker: `SILICONFLOW_RERANKER_MODEL`

- [x] **Step 3: Run gateway unit tests**

Run:

```powershell
node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts
```

Expected: all gateway tests pass.

## Task 2: Backend AI Service and Controller

- [x] **Step 1: Add service/controller behavior tests**

Extend `notes-backend/test/ai-gateway.test.ts`:

- `AiService.generateSummary` returns a model summary when gateway succeeds.
- `AiService.generateSummary` falls back to truncated plain content when gateway throws.
- `AiService.generateTopicName` returns a cleaned 2-6 word phrase and falls back to `General Topic`.
- `AiController` methods call the service with existing request shapes.

Run the focused test and confirm failure before implementation.

- [x] **Step 2: Replace Coze summary in `AiService`**

`AiService` should depend on `AiGatewayClient` and expose:

- `generateSummary(content: string): Promise<string>`
- `generateAggregateSummary(notes: any[]): Promise<{ summary: string }>`
- `generateWriterText(input): Promise<string>`
- `streamWriter(input): Promise<ReadableStream<Uint8Array>>`
- `generateMindmap(input): Promise<{ messages: Array<{ role: string; type: string; content: string }> }>`
- `generateMermaid(input): Promise<{ messages: Array<{ role: string; type: string; content: string }> }>`
- `chatPet(input): Promise<ReadableStream<Uint8Array>>`
- `generateEmbedding(text: string): Promise<number[]>`
- `generateTopicName(context: string): Promise<string>`

Existing frontend parsing is preserved by wrapping mindmap/mermaid answers in a Coze-like `messages` array.

- [x] **Step 3: Add authenticated backend AI endpoints**

Add `AiController` with `@UseGuards(AuthGuard('jwt'))` and routes under global `/api`:

- `POST /ai/writer`
- `POST /ai/writer/stream`
- `POST /ai/mindmap`
- `POST /ai/mermaid`
- `POST /ai/pet`
- `POST /ai/summary`

`/ai/pet` supports text only for this migration. If an image is sent, return HTTP 400 with an explicit message that image chat is not supported by the current provider route.

- [x] **Step 4: Run tests**

Run:

```powershell
node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts
```

Expected: pass.

## Task 3: Backend Semantic Migration

- [x] **Step 1: Replace Zhipu embedding service**

Modify `EmbeddingService` to call `AiService.generateEmbedding(text)`. It keeps the current empty-array fallback on failure so note creation and search do not hard-fail when the provider is unavailable.

- [x] **Step 2: Replace Coze topic naming**

Modify `SemanticService`:

- Remove `ConfigService` dependency if no longer needed.
- Replace `callCozeToNameTopic` with `this.aiService.generateTopicName(context)`.
- Keep existing fallback names when model calls fail.

- [x] **Step 3: Wire module imports**

Import `AiModule` into `SemanticModule` so `EmbeddingService` and `SemanticService` can inject `AiService`.

- [x] **Step 4: Run backend build**

Run:

```powershell
npm run build
```

from `notes-backend`.

Expected: TypeScript build passes.

## Task 4: Frontend BFF Proxy Migration

- [x] **Step 1: Create shared proxy helper**

Create `notes-frontend/src/app/api/ai/_proxy.ts`:

- `getBackendApiUrl()` uses `NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'`.
- `getAuthHeader()` reads `notes_token` from cookies.
- `unwrapBackendEnvelope()` returns `data` when backend returns `{ code, data }`.
- `proxyJson()` forwards JSON POST requests.
- `proxyStream()` forwards streaming text responses.

- [x] **Step 2: Replace route implementations**

Modify:

- `writer/route.ts`: JSON body -> `POST /ai/writer/stream`, stream response.
- `mindmap/route.ts`: JSON body -> `POST /ai/mindmap`, JSON response.
- `mermaid/route.ts`: JSON body -> `POST /ai/mermaid`, JSON response.
- `summary/route.ts`: JSON body -> `POST /ai/summary`, JSON response.
- `pet/route.ts`: FormData -> `POST /ai/pet`, stream response; reject image locally with a clear message until backend image chat exists.

No frontend route may reference `COZE_API_KEY`, `COZE_BOT_ID`, `api.coze.cn`, or `COZE_API_BASE`.

- [x] **Step 3: Run frontend type-check**

Run:

```powershell
npm run type-check
```

from `notes-frontend`.

Expected: TypeScript passes.

## Task 5: Verification

- [x] **Step 1: Search for removed direct providers**

Run:

```powershell
rg -n "COZE|ZHIPU|api.coze.cn|open.bigmodel.cn|MODELARK" notes-backend/src notes-frontend/src scripts docs/superpowers/plans/2026-06-03-ai-gateway-migration.md
```

Expected: no active source code call sites remain. Historical docs may mention old providers only as history.

- [x] **Step 2: Run required checks**

Run:

```powershell
npm run check:ai-config
npm run check:ai-config:live
npm run check:api-contract
npm run build
npm run type-check
git diff --check
git status --short --branch
```

Use repo root for root scripts, `notes-backend` for backend build, and `notes-frontend` for frontend type-check.

Expected:

- AI config dry/live checks pass with MiMo, SenseNova, and SiliconFlow.
- Backend build passes.
- Frontend type-check passes.
- API contract drift check still passes.
- Diff check has no whitespace errors.

## Verification Notes

- Backend unit tests: `34/34` passed.
- Backend build: `npm run build` passed.
- Frontend type-check: `npm run type-check` passed.
- Frontend editor focused Jest: `3` suites and `7` tests passed with `--no-cache --coverage=false`; the default cached run was blocked by local temp directory `ENOSPC`, not by assertion failures.
- AI config dry-run and live checks passed for MiMo, SenseNova DeepSeek, SiliconFlow embedding, and SiliconFlow reranker.
- API contract drift check passed with `9` registered drift rows.
- Active source scan found no backend/frontend Coze or Zhipu call sites; only the config checker still lists `COZE_`, `ZHIPU_`, and `MODELARK_` as forbidden frontend secret prefixes.
- `git diff --check` reported no whitespace errors, only Windows line-ending warnings.

## Self-Review

- Scope matches user sequence, with ModelArk corrected to SiliconFlow based on the latest verified provider decision.
- The plan keeps existing frontend call sites stable by preserving `/api/ai/*` routes and response shapes.
- The plan removes direct frontend Coze calls and backend Coze/Zhipu service calls.
- Missing config and provider failures are tested and converted to safe fallbacks for background note operations.
- No real `.env` value is committed or printed.
