# Task 4 完成报告

## 实现结果

- 新增 `RegisterCredentials`，注册 API 强制携带 `verificationCode`。
- 新增 `authAPI.sendEmailCode(email)` 与顶层 `sendEmailCode` 导出。
- 注册页增加 6 位数字验证码校验、发送按钮、60 秒倒计时、发送错误提示和 timer 清理。
- 注册 payload 保留 `email`、`password`、`verificationCode`，不提交 `confirmPassword`。
- 登录页删除 401/账号不存在时的自动注册回退；`auto=1` 仍会自动登录，但失败只展示登录错误。
- 将调用 `useSearchParams` 的登录内容置于有效的 `Suspense` 子边界内。

## TDD 证据

### RED

命令：

```text
npm exec -- jest __tests__/email-verification-registration.spec.tsx --runInBand
```

首次有效运行结果：1 个 suite 失败，5/5 tests 失败。失败原因分别为验证码控件/发送按钮缺失、注册验证码输入缺失，以及 `auto=1` 登录 401 后进入自动注册回退，符合预期 RED。

### GREEN

同一命令实现后结果：1 个 suite 通过，5/5 tests 通过。倒计时测试使用 Jest fake timers 验证 60→59，并在卸载后断言 timer 数为 0；`afterEach` 恢复 real timers。

## 验证

- `npm --prefix notes-frontend run type-check`：通过，exit 0。
- `npm --prefix notes-frontend run build`：通过，exit 0；`/login` 与 `/register` 均成功静态生成。
- build 仅输出既存的 `baseline-browser-mapping` / `caniuse-lite` 数据过期警告，未影响构建。
- 按任务要求未运行全量前端测试套件。

## 提交

- 提交信息：`feat(frontend): 增加邮箱验证码注册流程`
- 提交范围：Task 4 brief 指定的 5 个生产文件、1 个新增测试文件及本报告。

## 自查

- 未修改后端、Docker、生产环境文件或页面整体视觉设计。
- 浏览器端未加入 SMTP 配置、授权码或邮件发送实现，仅调用 `/auth/email-code`。
- 登录页不再 import/call `register`；注册链接保留。
- 发送按钮在发送中、注册中、倒计时期间禁用；发送前通过 `form.trigger('email')` 校验，并用 `form.getValues('email')` 取值。
- `git diff --check` 无空白错误。

## Concerns

- 无功能阻塞项。
- Jest 输出既存的 `ts-jest isolatedModules` 弃用警告；本 Task 未调整测试基础设施。

## Fix Round 1：窄屏验证码横排溢出

- Open Important：验证码 Input 与 `shrink-0` 按钮横排时缺少可收缩约束，窄屏可能溢出。
- RED：先新增 DOM class 回归测试；目标 Jest 结果为 1/6 失败，Input 实际 class 缺少 `min-w-0 flex-1`。
- GREEN：仅为验证码 Input 增加 `min-w-0 flex-1`，保留按钮 `shrink-0`；目标 Jest 6/6 通过。
- `npm --prefix notes-frontend run type-check`：通过，exit 0。
- Scope：未处理最终审查保留的 Minor（异步校验重入、pending 覆盖）。
- 提交信息：`fix(frontend): 修复验证码窄屏溢出`
