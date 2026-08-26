# 思维导图与笔记归属设计

## 业务定位

思维导图是笔记的附属资源，不提供独立列表页。每条 Mindmap 必须关联一篇 Note，并随 Note 删除。

## 数据约束

- Mindmap `noteId` 改为必填并建立索引。
- 创建时验证 Note 存在，且当前用户对 Note 具有编辑权限。
- 详情接口返回 `noteId`、`noteTitle`、Mindmap `title` 和 `content`。
- 更新接口允许 owner 更新 `title` 和 `content`；标题去除首尾空白，长度限制 1–80。
- 删除 Note 时在同一 MongoDB transaction 内删除 Note 及关联 Mindmap，避免部分成功产生孤儿数据。
- 移除详情页在 404 时自动创建 Mindmap 的行为。

## 导航与标题编辑

面包屑显示 `我的笔记 > {笔记标题} > {思维导图标题}`：

- “我的笔记”链接 `/dashboard/notes`。
- 笔记标题链接 `/dashboard/notes/{noteId}`。
- 思维导图标题支持原地编辑；Enter 或失焦保存，Esc 取消。
- 保存失败恢复原值并使用公共 Toast，不使用浏览器原生弹窗。
- 页面内返回按钮跳转关联笔记；由笔记编辑器弹出的窗口优先关闭。
- `/dashboard/mindmaps` 重定向 `/dashboard/notes`，不建设独立列表页。

## 一次性历史清理

截止时间采用 Asia/Shanghai 的 `2026-07-01 00:00:00`，对应 UTC `2026-06-30T16:00:00.000Z`；7 月 1 日及之后的数据保留。

dry-run 当前命中：`ai_runs` 1、`mindmaps` 3、`notes` 11、`auditentries` 8、`notifications` 2、`categories` 9、`users` 17、`noteversions` 2、`boards` 3、`savedfilters` 1、`invitations` 1、`tags` 14。当前测试账号 `user1@example.com` 不在范围内，且未发现 7 月后数据引用待删除的旧用户或旧笔记。

正式清理删除所有 `createdAt` 早于截止时间的项目数据，并级联删除这些主记录的依赖数据，避免引用断链。脚本默认 dry-run，必须显式传入执行参数才写入；输出各集合删除前后数量。

## 测试与验证

- 后端覆盖创建权限、必填 `noteId`、标题更新、详情关联信息和 Note 删除级联。
- 前端覆盖面包屑链接、标题编辑、返回行为、404 状态和 `/dashboard/mindmaps` 重定向。
- 清理脚本先 dry-run，再执行并复查孤儿引用为零。
- 运行前后端目标测试、前端类型检查、后端构建和浏览器实际导航验证。
