# AI 与只读权限聚焦修复设计

## 范围

本轮只处理本地双账号验收暴露的三个问题：AI 助手 `/api/ai/pet` 返回 500、viewer 仍请求笔记写锁、viewer 页面仍暴露可写入口。既有 owner/editor 能力、Yjs reader 服务端防线和非写入浏览功能保持不变。

## 设计

### AI 助手

沿 Next.js BFF、NestJS 流式控制器和 SenseNova gateway 定位失败点。用端到端形态的回归测试固定请求、鉴权转发与流式响应，仅修改造成 500 的边界，不增加新的 provider 抽象。

### 写锁

笔记加载并确定当前用户具有 owner/editor 权限后，才发送 lock；组件卸载或笔记切换时只为已经成功发起的写锁发送 unlock。viewer 不产生 lock/unlock 请求。

### 只读 UI

`canWriteNote` 是页面级写权限真相源。viewer 的正文和元数据不可编辑；保存、删除、AI 改写、评论、插入和格式化入口禁用或隐藏；列表卡片显示“查看”并隐藏删除入口。全屏、返回、浏览协作者等纯浏览能力保留。

## 验收

- AI 助手收到 SenseNova 文本流且 HTTP 非 500。
- viewer 网络面板无 lock/unlock 写请求，所有写入口不可用，正文不可编辑。
- owner/editor 保存及 owner 到 viewer 的协作同步不回归。
- 相关回归测试、前后端静态检查与构建、YWS 测试、双账号浏览器验收通过。
