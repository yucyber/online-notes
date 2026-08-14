# Task 1 Brief: 评论幂等键生成（修复 400）

## 项目背景

本项目 `notes-frontend` 是 Next.js 编辑器前端。用户反馈"添加评论请求 400 (Invalid Idempotency-Key)"。根因：后端幂等拦截器用正则 `/^[A-Za-z0-9._-]{8,64}$/` 校验 `Idempotency-Key` 请求头，但前端 `CommentsPanel.tsx` 用 `${noteId}:${start}:${end}:${text}` 拼接幂等键，含冒号和中文，必然不合法。本任务在前端生成合法幂等键。

## Global Constraints（必须遵守）

- 后端正则 `/^[A-Za-z0-9._-]{8,64}$/` **不改**，只在前端生成合法幂等键。
- 使用浏览器原生 SubtleCrypto（`crypto.subtle`），**不引入新依赖**。
- Commit message 用中文，格式 `fix(editor): 简述`。

## Files

- Create: `notes-frontend/src/lib/comments-key.ts`
- Create: `notes-frontend/__tests__/comments-key.spec.ts`
- Modify: `notes-frontend/src/components/collab/CommentsPanel.tsx`（第 52-55 行附近）

## Interfaces

- Produces: `buildCommentIdempotencyKey(noteId: string, start: number, end: number, text: string): Promise<string>` —— 返回 40 字符小写十六进制（SHA-1 摘要）。
- Consumes: `CommentsPanel.add()` 中替代现有 `${noteId}:${start}:${end}:${text}` 拼接。

## 步骤

### Step 1: 写失败测试

创建 `notes-frontend/__tests__/comments-key.spec.ts`，内容精确如下：

```ts
import { buildCommentIdempotencyKey } from '@/lib/comments-key'

describe('评论幂等键生成', () => {
  it('对同一参数产生稳定且符合后端字符集的键', async () => {
    const a = await buildCommentIdempotencyKey('abc123', 0, 5, '含中文评论')
    const b = await buildCommentIdempotencyKey('abc123', 0, 5, '含中文评论')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-z0-9]{40}$/)
  })

  it('不同文本产生不同键', async () => {
    const a = await buildCommentIdempotencyKey('abc123', 0, 5, '第一条')
    const b = await buildCommentIdempotencyKey('abc123', 0, 5, '第二条')
    expect(a).not.toBe(b)
  })

  it('冒号与中文不会进入最终键', async () => {
    const key = await buildCommentIdempotencyKey('a:b:c', 0, 5, '：中文：')
    expect(key).toMatch(/^[a-z0-9]{40}$/)
  })
})
```

### Step 2: 运行测试确认失败

Run: `cd notes-frontend && npx jest __tests__/comments-key.spec.ts --no-coverage`
Expected: FAIL，报 `Cannot find module '@/lib/comments-key'`。

### Step 3: 实现 `comments-key.ts`

创建 `notes-frontend/src/lib/comments-key.ts`，内容精确如下：

```ts
// 生成评论幂等键：用 SHA-1 把可能含冒号/中文的原始输入编码成后端允许的 [a-z0-9]{40}。
// 后端正则 /^[A-Za-z0-9._-]{8,64}$/，直接拼接 noteId:start:end:text 会因冒号与中文而 400。
const encoder = new TextEncoder()

function utf8Bytes(input: string): Uint8Array {
  return encoder.encode(`${input}`)
}

export async function buildCommentIdempotencyKey(noteId: string, start: number, end: number, text: string): Promise<string> {
  const raw = `${noteId}:${start}:${end}:${text}`
  const digest = await crypto.subtle.digest('SHA-1', utf8Bytes(raw))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

### Step 4: 运行测试确认通过

Run: `cd notes-frontend && npx jest __tests__/comments-key.spec.ts --no-coverage`
Expected: PASS（3 个用例全过）。

### Step 5: 接入 `CommentsPanel.tsx`

修改 `notes-frontend/src/components/collab/CommentsPanel.tsx`：
- 顶部 import 增加：`import { buildCommentIdempotencyKey } from '@/lib/comments-key'`
- 在 `add` 函数中，把现有行 `const idemKey = \`${noteId}:${selection.start}:${selection.end}:${text.trim()}\`` 替换为：

```ts
const idemKey = await buildCommentIdempotencyKey(noteId, selection.start, selection.end, text.trim())
```

（`add` 已是 `async` 函数，可直接 `await`。）

### Step 6: 跑相关测试 + 类型检查

Run: `cd notes-frontend && npx jest __tests__/comments-key.spec.ts __tests__/editor.tiptap.spec.tsx --no-coverage && npm run type-check`
Expected: 全部 PASS，type-check 无错误。

### Step 7: Commit

```bash
git add notes-frontend/src/lib/comments-key.ts notes-frontend/__tests__/comments-key.spec.ts notes-frontend/src/components/collab/CommentsPanel.tsx
git commit -m "fix(editor): 评论幂等键改为SHA-1编码修复400"
```

## 报告契约

完成后把报告写入 `C:\Users\Administrator\Desktop\online-notes\.superpowers\sdd\2026-08-12-editor-final-polish\task-1-report.md`，内容包括：
- 每个文件做了什么
- 运行的测试命令和结果
- commit hash
- 任何疑虑
