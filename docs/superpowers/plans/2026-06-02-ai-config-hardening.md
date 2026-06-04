# AI Config Hardening and Provider Migration Plan

> For agentic workers: this plan is the current handoff for AI provider configuration hardening. Do not print or commit real secret values.

## Goal

Make AI provider configuration safe, diagnosable, and ready for the next provider migration work:

- Keep model provider keys out of browser-visible env values.
- Use masked diagnostics for local verification.
- Verify live provider reachability only when explicitly requested.
- Record provider account issues separately from code issues.
- Track the remaining Coze/Zhipu application call sites before claiming AI features are fully migrated.

## Current Provider Direction

- MiMo: reasoning, long-context generation, graph extraction, and high-value multi-step workflows.
- SenseNova: OpenAI-compatible gateway for `deepseek-v4-flash`, used for fast text generation and common assistant flows.
- SiliconFlow: Qwen embedding/reranker provider. Planned models are `Qwen/Qwen3-Embedding-8B` and `Qwen/Qwen3-Reranker-8B`.
- Coze/Zhipu/ModelArk: removed from local provider configuration and no longer planned as fallback providers.

## Files Changed

- `scripts/check-ai-config.mjs`
  - Loads known env files.
  - Checks MiMo, SenseNova, SiliconFlow, and provider routing variables.
  - Masks all configured values as `<configured:length>`.
  - Supports live checks with `--live`.
  - Checks SiliconFlow `/models`, `/embeddings`, and `/rerank`.
  - Warns if provider secrets appear in frontend env files.
- `package.json`
  - Adds `check:ai-config`.
  - Adds `check:ai-config:live`.
- `notes-backend/.env.example`
  - Documents `MIMO_*`, `SENSENOVA_*`, `SILICONFLOW_*`, and `AI_*_PROVIDER` variables.
- `notes-frontend/src/app/api/ai/writer/route.ts`
- `notes-frontend/src/app/api/ai/mindmap/route.ts`
- `notes-frontend/src/app/api/ai/mermaid/route.ts`
- `notes-frontend/src/app/api/ai/pet/route.ts`
  - Removed runtime fallback to `NEXT_PUBLIC_COZE_API_KEY` / `NEXT_PUBLIC_COZE_BOT_ID`.

## Local Env Placement

Model provider keys should live in `notes-backend/.env`.

`notes-frontend/.env.local` should only contain public browser-safe values such as:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_YWS_URL=ws://localhost:1234
NEXT_PUBLIC_RUM_ENDPOINT=/api/rum/collect
```

## Required Backend Env Shape

```dotenv
MIMO_API_KEY=...
MIMO_BASE_URL=...
MIMO_MODEL=mimo-v2.5-pro

SENSENOVA_API_KEY=...
SENSENOVA_BASE_URL=https://token.sensenova.cn/v1
SENSENOVA_TEXT_MODEL=deepseek-v4-flash

SILICONFLOW_API_KEY=...
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
SILICONFLOW_RERANKER_MODEL=Qwen/Qwen3-Reranker-8B
SILICONFLOW_RERANKER_PATH=/rerank

AI_TEXT_PROVIDER=sensenova
AI_REASONING_PROVIDER=mimo
AI_EMBEDDING_PROVIDER=siliconflow
AI_RERANKER_PROVIDER=siliconflow
```

`SILICONFLOW_RERANKER_PATH` is optional; the diagnostic script defaults to `/rerank`.

## Verification Result on 2026-06-03

Commands run:

```powershell
npm run check:ai-config
npm run check:ai-config:live
npm run build
npm run type-check
npm run check:api-contract
git diff --check
```

Results before switching from ModelArk to SiliconFlow:

- Dry AI config check: OK. All required MiMo/SenseNova/ModelArk variables were configured and masked in output.
- Live AI config check:
  - MiMo chat: OK, HTTP 200.
  - SenseNova DeepSeek chat: OK, HTTP 200.
  - ModelArk model catalog returned the target embedding model, but embedding/chat calls failed with `未购买任何订阅套餐，请先购买订阅套餐后再尝试调用接口。`
- Backend build: OK.
- Frontend type-check: OK.
- API contract drift check: OK, 3 drift rows.
- Diff whitespace check: OK; only CRLF normalization warnings were printed.

Current SiliconFlow status:

- Config schema and diagnostic script have been switched from ModelArk to SiliconFlow.
- Live SiliconFlow checks require `SILICONFLOW_API_KEY` in `notes-backend/.env`.

## Remaining Provider Account Actions

- Add a SiliconFlow API key to `notes-backend/.env`.
- Confirm the account can call `Qwen/Qwen3-Embedding-8B` and `Qwen/Qwen3-Reranker-8B`.
- Rerun:

```powershell
npm run check:ai-config:live
```

## Remaining Code Migration Risk

Configuration is migrated, but application AI implementation is not fully migrated yet.

Known remaining Coze call sites:

- `notes-frontend/src/app/api/ai/writer/route.ts`
- `notes-frontend/src/app/api/ai/mindmap/route.ts`
- `notes-frontend/src/app/api/ai/mermaid/route.ts`
- `notes-frontend/src/app/api/ai/pet/route.ts`
- `notes-frontend/src/app/api/ai/summary/route.ts`
- `notes-backend/src/modules/ai/ai.service.ts`
- `notes-backend/src/modules/semantic/semantic.service.ts`

Known remaining Zhipu call site:

- `notes-backend/src/modules/semantic/embedding.service.ts`

Impact:

- Removing Coze/Zhipu/ModelArk env values is correct for the new direction.
- The current app will still fail or degrade on features whose implementation directly calls Coze/Zhipu.
- The next implementation step should introduce a backend AI provider layer and migrate existing AI features to MiMo/SenseNova/SiliconFlow through that layer.

## Recommended Next Implementation Order

1. Add backend AI provider clients for OpenAI-compatible chat and embedding calls.
2. Migrate backend `AiService.generateSummary` from Coze to the text/reasoning provider route.
3. Migrate `EmbeddingService.generateEmbedding` from Zhipu to SiliconFlow Qwen embedding.
4. Migrate topic naming in `SemanticService` from Coze to the text provider route.
5. Replace frontend AI BFF direct Coze calls with backend endpoints or remove the BFF layer where redundant.
6. Add focused tests for provider routing, missing config behavior, and provider error mapping.

## Commit Gate

Before committing this config hardening work:

```powershell
npm run check:ai-config
npm run build --workspace notes-backend
npm run type-check --workspace notes-frontend
npm run check:api-contract
git diff --check
git status --short
```

Do not commit real `.env`, `.env.local`, provider keys, or unrelated workspace changes.

## AI Gateway Migration Update on 2026-06-03

Implemented the first backend AI gateway migration pass:

- Added a unified NestJS AI gateway client for MiMo, SenseNova, and SiliconFlow.
- Migrated backend note summary generation away from Coze.
- Migrated embedding generation away from Zhipu to SiliconFlow `Qwen/Qwen3-Embedding-8B`.
- Migrated semantic topic naming away from Coze to the text provider route.
- Replaced frontend `/api/ai/*` direct Coze route handlers with proxies to backend `/api/ai/*` endpoints.
- Preserved the legacy `messages[{ type: "answer" }]` response shape for mindmap and Mermaid callers.
- Added focused backend tests for model routing, missing config, provider errors, embedding parsing, reranker parsing, and fallback behavior.

Known intentional limitation:

- AI pet image chat is disabled for now because the new provider route is text-only. Text chat continues through the backend AI gateway.
