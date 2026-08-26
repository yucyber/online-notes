# AI 思维导图与知识图谱可靠性设计

## 背景

思维导图后端成功返回数据时，运行中的 Next.js 代理仍可能保留统一响应 envelope；前端只读取顶层 `content`，因此把成功响应误判为失败，并调用原生 `alert`。知识图谱使用 `deepseek-v4-flash` 时频繁出现 429 和空 assistant content，有限重试无法提供稳定体验。

## 设计

### 思维导图

- `ai-client` 同时接受 `{ content }` 与 `{ code, data: { content } }`。
- 缺少 content 时继续抛出明确错误，不把任意对象当成有效图谱。
- 详情页捕获错误后使用项目公共 `appToast.error`，不再调用原生 `alert`。
- 成功后保持现有行为：将规范化图谱写入 AI context，由画布响应更新。

### 知识图谱

- `KnowledgeGraphBuildGraph` 改走 `text` route，对应 `sensenova-6.8-flash-lite`。
- 显式设置 `reasoningEffort: 'none'`，保留 JSON Output、严格 JSON prompt 和现有 `parseJsonObject` 清理。
- 保留 gateway 对 429/502/503/504 的有限重试和安全错误映射。
- AI run 审计按 `text` route 记录实际 Flash Lite 模型，避免审计模型与真实调用不一致。

## 验证

- 单测覆盖两种 mindmap 响应结构、缺失 content、公共 toast 失败提示、图谱 route/options。
- 后端完整单测与 TypeScript build 通过。
- 浏览器实际生成思维导图时无原生弹窗且画布更新。
- 知识图谱实际请求成功，AI run 记录模型为 `sensenova-6.8-flash-lite`。

