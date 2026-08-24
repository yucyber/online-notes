# 注释规范

适用范围：`notes-frontend/src`、`notes-backend/src`、`scripts/`、关键测试文件。

## 何时写注释

- 写或修改**复杂代码**时，用简洁中文说明业务原因、权限边界、失败降级和不直观时序。
- 只回答"为什么"和"有什么约束"——不逐行翻译代码，代码名称已经表达了"做什么"。
- API、类型、字段和通用技术术语（Yjs、embedding、ACL 等）保留英文。

## 何时不写注释

- 普通 CRUD、直观 JSX、简单赋值和无副作用的条件：不需要注释。
- 只是复述变量名或函数名的注释：删除。

## 测试

- 只注释复杂回归背景、特殊前置条件和关键断言目的。
- 测试名已能描述场景的，不重复添加注释。

## 维护要求

- 修改代码时同步更新相邻注释。
- 无法从当前调用链确认的语义不要写成事实。
- 失效注释（如与当前实现不符的旧描述）需删除或改写，不要保留误导性内容。

## 详细说明

参见 `docs/superpowers/specs/2026-08-07-code-comment-clarity-design.md`。

# Git 工作流规范

## 提交信息

- Commit message 统一使用**中文**撰写。
- 格式：`类型(范围): 简述`，如 `fix(backend): 修复登录态丢失问题`。
- 正文换行后补充原因和关键改动，不复述代码 diff。
- PowerShell 提交中文 commit message 时，用 `git commit -F <utf8文件>` 读取 UTF-8 文件，避免命令行直接写中文导致乱码。

## 分支命名

- 新分支格式：`类型-中文简述-YYYYMMDD`，如 `feat-笔记搜索-20260810`。
- `类型` 用英文小写：`feat` / `fix` / `chore` / `refactor` / `docs` / `test`。
- 中文简述要**简洁明了**，用连字符分隔多个词，如 `优化缓存策略`、`修复权限校验`。
- 日期取创建分支当天的日期。

# Debug 工作流规范

## 调试入口

- 排查 bug、报错、异常或回归问题时，先加载本项目专属 skill：`project-debug`。
- 该 skill 采用渐进式披露，入口在 `SKILL.md`，细节按需展开到 `workflow.md`、`debug-record-format.md`、`scripts.md`、`gotchas.md`。

## 记录 Debug 记录

- 当用户确认 bug 成功解决时，将「现象 → 根因 → 修复方案 → 相关文件 → 经验教训」追加进 `docs/debug-records.md`。
- 解决 bug 前先检索 `docs/debug-records.md`，避免重复踩坑。

## Skill 三处同步

- `project-debug` skill 同时维护在三个目录，内容须保持一致：
  - `.codebuddy/skills/project-debug/`
  - `.agents/skills/project-debug/`
  - `.claude/skills/project-debug/`
- 修改 skill 时，三处需同步更新，避免不同 agent 读到不一致的规范。
