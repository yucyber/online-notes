# 常用脚本清单

本项目 `scripts/` 目录下的常用排查/检查脚本，排查 bug 时可优先选用。

## 已有脚本

| 脚本 | 用途 | 运行方式 |
|------|------|----------|
| `scripts/check-api-contract.mjs` | 检查前后端 API 契约漂移 | `node scripts/check-api-contract.mjs` |
| `scripts/check-api-contract.test.mjs` | 契约检查的单元测试 | `node scripts/check-api-contract.test.mjs` |
| `scripts/check-ai-config.mjs` | 检查 AI 相关配置 | `node scripts/check-ai-config.mjs` |
| `scripts/predeploy-check.ps1` | 部署前检查 | `pwsh scripts/predeploy-check.ps1` |
| `scripts/test-collaboration-stability.js` | 协作稳定性测试 | `node scripts/test-collaboration-stability.js` |

## 项目根目录脚本

| 脚本 | 用途 |
|------|------|
| `predeploy.ps1` | 部署前准备 |
| `setup_stress.ps1` | 压测环境初始化 |

## 运行约定

- 命令统一在项目根目录执行。
- Windows 环境用 PowerShell，`.ps1` 脚本用 `pwsh` 或 `powershell` 运行。
- 脚本输出若报错，先把错误信息完整贴出，再判断是脚本问题还是项目问题。

## 补充新脚本

排查过程中沉淀的常用命令/脚本，可以：
1. 脚本本身放进 `scripts/` 目录；
2. 在这里登记一行说明（脚本名 + 用途 + 运行方式）。
