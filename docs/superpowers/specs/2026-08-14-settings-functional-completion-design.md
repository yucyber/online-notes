# 设置页功能补全设计

## 目标

设置页只展示已有真实能力：账户资料、编辑器布局偏好与危险操作。删除账户保留禁用状态；头像、通知和自动保存设置不进入本期范围。

## 方向 A：共享编辑器布局偏好

将 `useEditorLayoutPreferences` 的组件私有状态迁移到模块级 external store，并继续使用 `notes:editor-layout:v1`。store 保留当前完整结构与外部 API：`preferences`、`toggleLeft`、`toggleRight`、`setLeftWidth`，避免破坏编辑器现有右栏折叠和拖拽宽度行为。设置页仅消费左栏折叠和三档宽度（220、280、360 px）。

store 使用 `useSyncExternalStore` 让已打开的编辑器与设置页即时联动；SSR 快照保持当前默认值。未显式保存偏好时，继续响应视口断点；发生显式操作后，不再被 resize 默认值覆盖。localStorage 不可用时仅保留当前会话状态。

## 方向 B：用户资料编辑

`User` 新增可选 `displayName`。`PATCH /users/me` 由 JWT guard 保护，只允许从 `req.user.id` 更新当前用户；DTO 对名称去除首尾空白后校验 1–32 个字符。users service 查找并保存用户，序列化依赖 schema 现有脱敏逻辑。注册、登录与 `/auth/me` 返回均包含 `displayName`。

前端增加 profile API 和本地登录态更新函数。设置页保存成功后同时更新组件状态与 `notes_user`，从而触发现有 `notes:auth-changed` 事件；失败时保留用户输入并显示错误 Toast。

## 设置页信息架构

- 账户信息：显示名称（可编辑）、邮箱和创建时间（只读）。
- 编辑偏好：左栏折叠开关、窄/标准/宽三段宽度选择。
- 危险操作：退出登录；删除账户维持禁用并明确后端尚未开放。

桌面端沿用原稿的左侧锚点导航与 720 px 内容列；窄屏导航改为横向换行。移除没有持久化或后端支持的自动保存、邮件通知和网络状态设置卡片。

## 错误与测试

- 后端覆盖 DTO 边界、当前用户更新与路由守卫。
- 前端覆盖 external store 跨订阅者同步、持久化兼容、设置页保存成功/失败和布局控件联动。
- 验证包括前后端定向测试、TypeScript 检查和构建。

