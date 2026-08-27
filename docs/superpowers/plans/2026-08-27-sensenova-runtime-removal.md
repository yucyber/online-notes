# SenseNova Runtime Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove SenseNova from every active backend/configuration path while preserving current text, reasoning, stream, fallback, embedding, rerank, and public API behavior.

**Architecture:** Keep the existing `text | reasoning` compatibility interface but resolve both routes through SiliconFlow: standard Qwen for text and DeepSeek-V4-Flash for reasoning. B.AI remains the cross-provider fallback for eligible task failures; AgentRouter remains an explicit expert-quality target rather than a default provider.

**Tech Stack:** Node.js 22、TypeScript、NestJS 10、Node Test Runner、SiliconFlow OpenAI-compatible API、B.AI、AgentRouter。

## Global Constraints

- Work in the current workspace as explicitly authorized; preserve unrelated user changes.
- Use TDD for production behavior changes and observe each new test fail for the intended reason.
- Do not modify controller/DTO/frontend API contracts or prompt/response shapes.
- Do not change embedding dimensions, vector models, reranker models, or Atlas index contracts.
- Active runtime/config paths must contain no `sensenova` or `SENSENOVA_`; historical documents remain as audit history.
- Commit messages use Chinese `类型(范围): 简述` format.

---

### Task 1: Route compatibility text and reasoning through SiliconFlow

**Files:**
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`
- Modify: `notes-backend/test/knowledge-graph-build-graph.test.ts`

**Interfaces:**
- Consumes: `AiGatewayClient.chat(options: AiChatOptions)` and `streamChat(options: AiChatOptions)`.
- Produces: `route=text` → SiliconFlow standard config; `route=reasoning` → SiliconFlow deep config.

- [ ] **Step 1: Replace the two default routing tests with failing SiliconFlow expectations**

Use literal expectations:

```ts
assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/chat/completions')
assert.equal(calls[0].body.model, 'Qwen/Qwen3-14B')
assert.equal(calls[0].headers.Authorization, 'Bearer siliconflow-secret')
```

For reasoning expect `deepseek-ai/DeepSeek-V4-Flash`. Add a rejection test proving `AI_TEXT_PROVIDER=sensenova` raises `Unsupported text AI provider: sensenova`.

- [ ] **Step 2: Run the gateway test and verify RED**

Run: `node -r ts-node/register -r tsconfig-paths/register --test test/ai-gateway.test.ts`

Expected: default text/reasoning expectations fail because production still resolves SenseNova; the explicit removed-provider test also fails.

- [ ] **Step 3: Implement the minimal SiliconFlow provider mapping**

Change `resolveChatProviderName` default to `siliconflow`. In `chatProviderKeys`, support only:

```ts
if (provider === 'siliconflow') {
  return {
    apiKey: 'SILICONFLOW_API_KEY',
    baseUrl: 'SILICONFLOW_BASE_URL',
    model: route === 'reasoning'
      ? 'SILICONFLOW_DEEP_REASONING_MODEL'
      : 'SILICONFLOW_STANDARD_TEXT_MODEL',
  }
}
```

Remove the SenseNova branch and stale comments. Keep AR only as an explicit expert target if required by the already-approved AR adapter, never as a default provider.

- [ ] **Step 4: Adapt reasoning parameters without changing task contracts**

For SiliconFlow Qwen with `reasoningEffort=none`, send `enable_thinking=false`. For non-Qwen SiliconFlow deep models, do not invent `reasoning_effort`; preserve `response_format`, temperature, max token, retry, stream, and response extraction behavior.

- [ ] **Step 5: Update model audit fixtures and verify GREEN**

Replace active test fixture values such as `{ provider: 'sensenova', model: 'sensenova-6.8-flash-lite' }` with SiliconFlow standard/deep literals. Run the gateway and graph tests; expect all assertions to pass.

- [ ] **Step 6: Commit the runtime route migration**

```powershell
git add -- notes-backend/src/modules/ai/ai-gateway.client.ts notes-backend/test/ai-gateway.test.ts notes-backend/test/knowledge-graph-build-graph.test.ts
git commit -m "refactor(ai): 移除商汤运行时路由"
```

---

### Task 2: Remove SenseNova from deployment configuration and checks

**Files:**
- Create: `scripts/check-ai-config.test.mjs`
- Modify: `scripts/check-ai-config.mjs`
- Modify: `notes-backend/.env.example`

**Interfaces:**
- Consumes: environment files merged by `check-ai-config.mjs`.
- Produces: dry-run report for SiliconFlow, B.AI and optional AR without exposing secrets.

- [ ] **Step 1: Write a failing configuration-script behavior test**

Run the script in a temporary working directory containing a controlled `notes-backend/.env` with SiliconFlow/B.AI/AR variables and assert:

```js
assert.equal(result.status, 0)
assert.match(result.stdout, /SILICONFLOW_STANDARD_TEXT_MODEL/)
assert.match(result.stdout, /BAI_FALLBACK_MODEL/)
assert.match(result.stdout, /AR_MODEL/)
assert.doesNotMatch(result.stdout, /SENSENOVA_|MIMO_/i)
```

Also add a fixture with `AI_TEXT_PROVIDER=sensenova` and assert the script warns that only `siliconflow` is accepted.

- [ ] **Step 2: Run the script test and verify RED**

Run: `node --test scripts/check-ai-config.test.mjs`

Expected: failure because the current report still includes SenseNova or the controlled script setup is not yet supported.

- [ ] **Step 3: Remove SenseNova configuration and live checks**

Delete `SENSENOVA_*` required rows, URL validation, frontend secret prefix and SenseNova live call. Validate `AI_TEXT_PROVIDER` and `AI_REASONING_PROVIDER` against `siliconflow` only. Live chat checks must use `SILICONFLOW_STANDARD_TEXT_MODEL` and `SILICONFLOW_DEEP_REASONING_MODEL`.

- [ ] **Step 4: Finalize `.env.example`**

Remove the entire SenseNova compatibility block and keep:

```env
AI_TEXT_PROVIDER=siliconflow
AI_REASONING_PROVIDER=siliconflow
AI_EMBEDDING_PROVIDER=siliconflow
AI_RERANKER_PROVIDER=siliconflow
```

Keep B.AI and AR configuration with comments describing their fallback/expert roles.

- [ ] **Step 5: Verify GREEN and commit configuration migration**

Run `node --test scripts/check-ai-config.test.mjs`, `npm run check:ai-config`, and `node --check scripts/check-ai-config.mjs`.

```powershell
git add -- scripts/check-ai-config.mjs scripts/check-ai-config.test.mjs notes-backend/.env.example
git commit -m "chore(ai): 清理商汤配置入口"
```

---

### Task 3: Update current documentation and verify the complete migration

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-ai-model-routing-and-reasoning-design.md`
- Modify: `docs/superpowers/plans/2026-08-27-knowledge-ai-platform-master-execution-plan.md`
- Modify: `docs/debug-records.md`
- Preserve as history: older SenseNova-specific specs/plans and project progress documents.

**Interfaces:**
- Produces: current routing documentation consistent with active code and retained historical audit trail.

- [ ] **Step 1: Mark the current routing truth**

State that SenseNova is removed from active runtime configuration. Remove migration-period language that says old SenseNova variables remain. Update current code baseline/test counts only from fresh verification output.

- [ ] **Step 2: Preserve historical documents explicitly**

Add one concise note to relevant current index/current plan that older SenseNova documents describe superseded behavior. Do not rewrite old incident details or historical provider results.

- [ ] **Step 3: Verify active-path removal**

Run:

```powershell
rg -n -i "sensenova|SENSENOVA_" notes-backend/src notes-backend/test notes-backend/.env.example scripts/check-ai-config.mjs scripts/check-ai-config.test.mjs
```

Expected: no matches.

- [ ] **Step 4: Run full verification**

Run backend unit tests and build, configuration tests/dry-run, then minimal live smoke tests for SiliconFlow text, SiliconFlow reasoning, B.AI fallback availability and AR expert availability. Do not print keys or full prompts.

- [ ] **Step 5: Commit documentation and verification records**

```powershell
git add -- docs/superpowers/specs/2026-08-27-ai-model-routing-and-reasoning-design.md docs/superpowers/plans/2026-08-27-knowledge-ai-platform-master-execution-plan.md docs/debug-records.md
git commit -m "docs(ai): 记录商汤路由淘汰结果"
```
