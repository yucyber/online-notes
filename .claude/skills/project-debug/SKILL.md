---
name: project-debug
description: 本项目（online-notes）专属的调试与 bug 排查 skill。触发场景：排查 bug、处理报错、复现异常、修复回归问题时使用。包含：bug 解决流程规范、Debug 记录文档的读写约定、常用脚本清单、以及本项目技术栈（NestJS + Mongoose + MongoDB + Next.js + Yjs）的常见坑位。遇到任何 bug 或异常，先加载本 skill。
---

# Project Debug Skill

针对 `online-notes` 项目的调试与 bug 排查指南。

## 何时使用

- 排查任何 bug、报错、测试失败或异常行为
- 复现并修复回归问题
- 需要了解项目历史踩坑记录或常用排查脚本时

## 核心原则（先读）

1. **动手前先查 Debug 记录**：解决 bug 前，先检索 `docs/debug-records.md`，看是否已有同类问题的根因与解决方案。
2. **确认解决后写入 Debug 记录**：当用户确认 bug 成功解决时，将「现象 → 根因 → 修复方案 → 相关文件 → 经验教训」追加进 `docs/debug-records.md`。
3. **证据先行**：不要凭猜测下结论，用日志、数据库查询、脚本输出确认根因后再修复。

## 详细内容（按需展开）

- 完整的 bug 解决流程规范 → 见 `workflow.md`
- Debug 记录文档格式与写入规范 → 见 `debug-record-format.md`
- 常用排查脚本清单与用法 → 见 `scripts.md`
- 本项目常见坑位（技术栈相关） → 见 `gotchas.md`
