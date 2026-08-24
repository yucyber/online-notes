# Debug 记录

本文件记录项目排查过的 bug 根因与修复方案，供后续 agent 检索参考。

---

## 活动日志查不到"创建了笔记"记录（note_created）

- **日期**：2026-08-24
- **现象**：创建新笔记后，活动日志页面"笔记"tab 和"全部动作"tab 均查不到"创建了笔记"（`note_created`）记录，但数据库 `auditentries` 集合中该记录确实存在。

- **根因**：`audit.service.ts` 中写入与查询的 `resourceId` 类型不一致。
  - 写入侧 `record()` 使用 `new Types.ObjectId(resourceId)`，存成 **ObjectId 类型**。
  - 查询侧 `list()` 原来用 `editableNoteIdsAsStrings`（**字符串数组**）做 `$in` 匹配。
  - Mongoose 对 `$in` 数组里的字符串不会可靠地自动 cast 成 ObjectId，导致 ObjectId 存储的记录永远匹配不上，查询为空。

- **相关文件**：
  - `notes-backend/src/modules/audit/audit.service.ts`
  - `notes-backend/src/modules/audit/schemas/audit-entry.schema.ts`（其中 `resourceId` 声明为 `@Prop({ type: Types.ObjectId })`）

- **修复方案**：在 `list()` 的 `$in` 数组里同时放入 ObjectId 和字符串两种形态，兼容新旧存储：
  ```typescript
  const editableNoteIdsAsObjectIds = editableNoteIds.map(id => new Types.ObjectId(String(id)))
  const query: any = { resourceId: { $in: [...editableNoteIdsAsObjectIds, ...editableNoteIdsAsStrings] } }
  ```

- **经验教训**：写入与查询两侧对同一字段的类型处理必须一致；涉及 ObjectId 的 `$in` 查询不要依赖 mongoose 隐式 cast，应显式转换或双形态兼容。
