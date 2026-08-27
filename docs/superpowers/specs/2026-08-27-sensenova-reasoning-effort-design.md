# SenseNova reasoning_effort 参数修正设计

## 背景

当前 `AiGatewayClient` 将 SenseNova 排除在 `reasoning_effort` 支持范围之外，原因是旧判断认为官方接口未声明该参数。SenseNova 当前官方文档已明确：文本对话模型支持 `reasoning_effort`，可选值为 `low`、`medium`、`high` 和 `none`。

这导致摘要调用即使传入 `reasoningEffort: 'none'`，网关也不会把参数发送给 SenseNova，模型仍可能执行不需要的推理。

## 目标

- SenseNova 文本对话请求应透传调用方显式提供的 `reasoningEffort`。
- 未提供该选项时不新增默认值，保持现有调用行为。
- 摘要调用可通过 `reasoningEffort: 'none'` 关闭推理；推理调用仍可使用其他力度。
- 不引入模型白名单，不修改其他 provider 的现有行为。

## 实现

1. 将现有回归测试从“SenseNova 不发送 `reasoning_effort`”改为“SenseNova 透传显式 `reasoning_effort`”。
2. 先运行该测试并确认它因现有排除逻辑失败。
3. 删除 SenseNova 的特殊排除逻辑及失效注释，使已有通用透传分支覆盖 SenseNova。
4. 运行 AI gateway 单元测试和后端构建。
5. 使用当前环境中的 API Key 发起一条最小 `glm-5.2` 请求，验证实际请求链路；不输出 API Key。

## 错误处理边界

本次不调整重试策略。若真实请求仍返回 `insufficient_quota`，记录响应状态和错误码，视为平台额度问题，不能把参数透传修正误报为已解决配额问题。

## 验收标准

- 单元测试确认 SenseNova 请求体包含调用方指定的 `reasoning_effort`。
- AI gateway 全部单元测试通过。
- 后端 TypeScript 构建通过。
- 真实请求结果被明确记录：成功则报告正文；失败则报告准确的 HTTP 状态和错误码。
