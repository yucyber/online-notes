# SenseNova 路由与限流恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让高频 Pet 使用 Flash Lite，让结构化知识图谱使用 DeepSeek，并在 SenseNova 瞬时 429 时有限重试且保留最终 HTTP 语义。

**Architecture:** `AiGatewayClient` 继续作为唯一 provider 边界，按 route 读取独立模型配置并构造 OpenAI-compatible 请求；provider 错误由一个带 HTTP status 的异常表达。业务 graph 只声明推理强度和 JSON 输出需求，HTTP filter 统一映射最终状态。

**Tech Stack:** NestJS 10、TypeScript、Node.js test runner、OpenAI-compatible Chat Completions

## Global Constraints

- 仅修改 `notes-backend/src/modules/ai`、全局异常过滤器及关键 AI 单测。
- 复杂重试时序用简洁中文说明业务原因；直观映射不写注释。
- 不修改用户现有前端工作树改动，不提交 Git commit。
- 429/502/503/504 最多重试 2 次；其他 4xx 不重试。

---

### Task 1: 按 route 选择模型并传递模型能力参数

**Files:**
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.types.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`

**Interfaces:**
- Consumes: `AI_TEXT_PROVIDER`、`AI_REASONING_PROVIDER`、`SENSENOVA_TEXT_MODEL`、`SENSENOVA_REASONING_MODEL`
- Produces: `AiChatOptions.reasoningEffort`、`AiChatOptions.responseFormat`

- [ ] **Step 1: Write the failing tests**

  添加行为测试：reasoning route 必须发送 `SENSENOVA_REASONING_MODEL`；可选 `reasoning_effort` 和 `response_format` 必须进入请求体。

- [ ] **Step 2: Run tests to verify they fail**

  Run: `node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts`

- [ ] **Step 3: Write minimal implementation**

  为 `AiChatOptions` 增加两个可选字段，并让 SenseNova route 按 route 读取对应 model key；仅在调用方提供时发送能力参数。

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts`

### Task 2: 为 Pet 与知识图谱设置合适参数

**Files:**
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `notes-backend/test/knowledge-graph-build-graph.test.ts`
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
- Modify: `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`

**Interfaces:**
- Consumes: Task 1 的 `AiChatOptions`
- Produces: Pet `reasoningEffort: 'none'`、`maxTokens: 400`；图谱 `reasoningEffort: 'low'` 与 JSON object 输出

- [ ] **Step 1: Write failing behavior tests**

  断言 Pet 与知识图谱传给真实 gateway 边界的 options，而不是检查源码常量。

- [ ] **Step 2: Run targeted tests and verify failure**

  Run: `node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts test/knowledge-graph-build-graph.test.ts`

- [ ] **Step 3: Implement the minimum parameter changes**

  Pet 关闭思考并降低普通问答输出上限；图谱使用 low reasoning 和 JSON object。

- [ ] **Step 4: Run targeted tests and verify pass**

  Run: `node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts test/knowledge-graph-build-graph.test.ts`

### Task 3: 有限重试并保留最终 provider HTTP 状态

**Files:**
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`

**Interfaces:**
- Produces: `AiProviderHttpError extends HttpException`

- [ ] **Step 1: Write failing retry/error tests**

  覆盖 429 后成功、400 不重试、连续 429 最终仍为 HTTP 429 三种行为；测试注入零延迟避免真实等待。

- [ ] **Step 2: Run targeted test and verify failure**

  Run: `node --require ts-node/register --require tsconfig-paths/register --test test/ai-gateway.test.ts`

- [ ] **Step 3: Implement bounded retry**

  provider boundary 对 429/502/503/504 做两次指数退避；耗尽后抛出 `HttpException` 子类，由现有 filter 映射为 `42900` 或 `50300`。

- [ ] **Step 4: Run full verification**

  Run: `npm run test:unit && npm run build`

