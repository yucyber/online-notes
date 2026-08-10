# AI 与只读权限聚焦修复实施计划

1. [x] 复查 AI Pet 流式调用并定位原 500：当前 SenseNova provider 修复已使 backend 与 BFF 均稳定返回文本流，未再增加重复实现。
2. [x] 实际验证 SenseNova：浏览器 `/api/ai/pet` 返回 201，页面显示预期回答。
3. [x] 为 viewer 写锁补回归测试并修复 effect 权限门禁；owner 仍正常申请写锁。
4. [x] 为列表与编辑器只读写入口补回归测试并统一权限表现。
5. [x] 运行 frontend、backend、YWS 定向及全量验证。
6. [x] 使用 user1/user2 完成 AI、只读、owner 写锁与协作页面浏览器验收。
7. [x] 记录结果并停止扩展优化。

## 验收记录

- frontend：Jest 全量、type-check、lint、production build 通过。
- backend：85 个 unit tests 与 TypeScript build 通过。
- YWS：6 个 tests 通过；浏览器能取得 reader/writer room ticket，reader 服务端写过滤已有专项测试。
- 浏览器：AI Pet 201；viewer `/lock` 0 请求、写控件全部禁用、列表显示“查看”且无删除；owner `/lock` 201。
- 未纳入：更大范围 UI 美化、偶发内容重复、通用 capability 权限系统。
