# SenseNova reasoning_effort 参数修正实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SenseNova 文本对话请求透传调用方显式指定的 `reasoning_effort`，并通过单元测试、构建和真实请求验证。

**Architecture:** 保留 `AiGatewayClient.chatBody` 现有的统一请求体构建入口，移除基于 provider 的 SenseNova 特殊排除。调用方仍负责选择 `none`、`low`、`medium` 或 `high`，未传值时请求体不包含该字段。

**Tech Stack:** TypeScript、NestJS、Node.js test runner、SenseNova OpenAI-compatible API

## Global Constraints

- 只修改 AI gateway 参数透传行为和对应回归测试。
- 未提供 `reasoningEffort` 时不得新增默认值。
- 不调整现有重试策略。
- 不输出或提交 `SENSENOVA_API_KEY`。
- 复杂逻辑注释使用简洁中文；失效注释必须删除或改写。

---

### Task 1: 修正 SenseNova reasoning_effort 透传

**Files:**
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`

**Interfaces:**
- Consumes: `AiChatOptions.reasoningEffort`，类型为 `'none' | 'low' | 'medium' | 'high' | undefined`
- Produces: OpenAI-compatible 请求体字段 `reasoning_effort`；仅在调用方显式提供时存在

- [x] **Step 1: 将旧测试改为期望 SenseNova 透传参数**

将 `AiGatewayClient does not send reasoning_effort to SenseNova` 替换为：

```ts
test('AiGatewayClient forwards explicit reasoning_effort to SenseNova', async () => {
  const calls: Array<{ body: any }> = []
  const fetchImpl = async (_url: any, init: any) => {
    calls.push({ body: JSON.parse(init.body) })
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await client.chat({
    route: 'text',
    prompt: 'hello',
    reasoningEffort: 'none',
  })

  assert.equal(calls[0].body.reasoning_effort, 'none')
})
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `npm run test:unit --prefix notes-backend`

Expected: 新测试失败，实际 `reasoning_effort` 为 `undefined`，证明测试覆盖了 SenseNova 特殊排除逻辑。

- [x] **Step 3: 实现最小修正**

在 `chatBody` 中直接透传调用方显式提供的值：

```ts
if (options.reasoningEffort) {
  body.reasoning_effort = options.reasoningEffort
}
```

删除 `supportsReasoningEffort` 方法以及“SenseNova 不支持该参数”的失效注释。不添加 `thinking` 字段，不为缺省请求设置默认推理力度。

- [x] **Step 4: 运行单元测试和构建**

Run: `npm run test:unit --prefix notes-backend`

Expected: 全部单元测试通过。

Run: `npm run build --prefix notes-backend`

Expected: TypeScript 编译成功且退出码为 0。

- [x] **Step 5: 使用当前环境执行真实最小请求**

从 `notes-backend/.env` 读取 `SENSENOVA_API_KEY`、`SENSENOVA_BASE_URL` 和 `SENSENOVA_TEXT_MODEL`，向 `/chat/completions` 发送：

```json
{
  "model": "glm-5.2",
  "messages": [{ "role": "user", "content": "只回复：正常" }],
  "max_tokens": 32,
  "temperature": 0,
  "reasoning_effort": "none"
}
```

Expected: 请求成功时返回非空正文；若失败，记录 HTTP 状态、错误码和 `X-Request-ID`，但不输出 API Key。`insufficient_quota` 仍视为平台额度问题。

- [x] **Step 6: 提交实现**

```powershell
git add -- 'notes-backend/test/ai-gateway.test.ts' 'notes-backend/src/modules/ai/ai-gateway.client.ts'
git commit -m "fix(ai): 透传 SenseNova 推理力度参数" -m "依据当前官方文档允许摘要链路显式关闭推理，并更新对应回归测试。"
```
