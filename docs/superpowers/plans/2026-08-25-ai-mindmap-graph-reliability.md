# AI 思维导图与知识图谱可靠性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除思维导图成功响应误报，并让知识图谱稳定使用 Flash Lite。

**Architecture:** 前端 AI client 在网络边界规范化 envelope，页面只负责更新状态和展示公共 toast；知识图谱 graph 声明 text route 与无推理参数，gateway 继续负责模型选择和重试。

**Tech Stack:** Next.js、React、NestJS、TypeScript、Jest、Node.js test runner

## Global Constraints

- 不修改现有知识库笔记选择相关前端改动。
- 不使用原生 `alert` 显示 AI 生成错误。
- 不增加新的 provider 抽象或依赖。

---

### Task 1: 规范化思维导图响应并替换错误提示

**Files:**
- Modify: `notes-frontend/src/lib/ai-client.ts`
- Modify: `notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
- Test: `notes-frontend/__tests__/ai-client.spec.ts`
- Test: `notes-frontend/__tests__/mindmap-detail-page.spec.tsx`

- [ ] 写 envelope 与公共 toast 的失败测试。
- [ ] 运行目标测试并确认按预期失败。
- [ ] 实现双结构解包和 `appToast.error`。
- [ ] 运行目标测试并确认通过。

### Task 2: 将知识图谱切换到 Flash Lite

**Files:**
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
- Modify: `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`
- Test: `notes-backend/test/knowledge-graph-build-graph.test.ts`

- [ ] 写 route、reasoning 和审计 route 的失败测试。
- [ ] 运行目标测试并确认按预期失败。
- [ ] 将 graph 和审计 route 改为 text/none。
- [ ] 运行目标测试并确认通过。

### Task 3: 完整验证

- [ ] 运行前端目标测试与类型检查。
- [ ] 运行后端完整单测与 build。
- [ ] 浏览器验证思维导图和知识图谱真实流程。
- [ ] 检查 diff 仅包含本方案文件与既有改动。

