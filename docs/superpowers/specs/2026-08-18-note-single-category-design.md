# 笔记单分类模型设计

## 背景

笔记当前同时保存 `categoryId` 和 `categoryIds`，编辑器也同时提供“分类”和“附属分类”。这使同一个分类概念拥有两套字段、保存路径、计数逻辑和展示兼容分支。项目尚未上线，不需要迁移或兼容旧数据，因此直接收口为单分类模型。

## 目标

- 一篇笔记最多属于一个分类，只使用 `categoryId`。
- API 响应中的 `categoryId` 始终是 string ID，不再返回分类对象或额外的 `category` 别名。
- 删除所有多分类写入、附属分类 UI、旧数据兼容和重复计数逻辑。
- 分类保存成功后，返回笔记列表立即显示新分类；保留本次已实现的前后端列表缓存失效机制。

## 删除范围

### 前端

- 从 `Note`、`CreateNoteDto`、`UpdateNoteDto` 和 `NoteFilterParams` 删除 `categoryIds` 与 `categoriesMode`。
- 从新建页和编辑器删除“附属分类”区域、树形选择、相关 state、props、快照及自动保存字段。
- 从笔记 API 的请求构造、缓存 key、推荐上下文和响应归一化删除 `categoryIds`。
- 搜索栏只保留单个 `categoryId` 筛选，删除多分类选择与 any/all 模式。
- 列表分类文案只根据 `note.categoryId` 和分类字典解析，不再读取 `note.category` 或嵌套分类对象。

### 后端

- 从 Note schema 删除 `categoryIds` 字段和索引。
- 从 NoteVersion schema、快照与恢复逻辑删除 `categoryIds`。
- 从 create、update 和 filter DTO 删除 `categoryIds` 与 `categoriesMode`。
- 创建和更新时只校验 `categoryId`，不再合并单值与数组。更新请求中省略字段表示“不修改”，显式传 `null` 表示“清空分类”。
- 列表查询只按 `categoryId` 过滤，删除针对 `categoryIds` 的 `$in`/`$all` 分支，以及 ObjectId/String 双形态兼容查询。
- 列表、推荐和版本查询不再 select/project `categoryIds`。
- `NoteCounterService` 只接收单个 `categoryId`，删除收集和去重多分类 ID 的辅助逻辑。
- 审计字段白名单移除 `categoryIds`。

## 数据与接口形态

笔记读取与创建字段统一为：

```ts
categoryId?: string
```

更新接口需要区分“不修改”和“清空”，因此使用：

```ts
categoryId?: string | null
```

详情和列表接口均只返回 string ID。后端内部 schema 仍保存 MongoDB `ObjectId`，由 Mongoose JSON 序列化为 string。前端通过分类列表构建 `Record<categoryId, categoryName>`，展示时查表获取名称。

项目未上线，因此不编写数据迁移脚本，不读取或回填已有 `categoryIds`，也不保留兼容分支。

## 缓存一致性

- 笔记 create、update、delete 成功后清理前端列表缓存。
- 后端使用 Redis 列表 revision 使 owner 和协作者视角的旧列表同时失效。
- 后台重验证事件与当前页使用同一个规范化缓存 key，包含筛选、页码和页大小。

## 测试

- 类型检查保证前后端不再引用已删除字段。
- 单元测试覆盖创建、更新、删除时的单分类计数和分类归属校验。
- 列表查询测试确认只生成 `categoryId` 条件。
- 前端回归测试确认更新分类后不会命中旧列表缓存。
- 运行前端生产构建、后端构建和后端完整单元测试。

## 非目标

- 不改变分类管理本身的父子层级；分类树仍可用于组织分类，但笔记只能选择其中一个节点。
- 不修改标签的多选能力。
- 不迁移或兼容旧数据库数据。
