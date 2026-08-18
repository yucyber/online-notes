# 协作侧栏高保真实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将编辑器协作模块完整改造成设计稿中的 340px 高保真侧栏，并接通成员权限与邀请管理交互。

**Architecture:** 后端 ACL 查询直接 populate 创建者与协作者的公开资料，返回统一成员列表和 `canManage` 权限位；前端面板负责数据编排，成员行组件只负责呈现和菜单事件；所有视觉参数集中在编辑器样式表中的协作侧栏命名空间。抽屉容器继续由 `NoteEditorDrawers` 管理，实时参与者由编辑器外壳传入，不改变 Yjs 连接逻辑。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS 3、Lucide React、NestJS、Mongoose。

## Global Constraints

- `.superpowers/brainstorm/codex-20260818110807/content/collab-drawer-directions.html` 是唯一视觉基线，CSS 数值优先于现有通用组件默认样式。
- 桌面端抽屉严格为 340px、标题栏 56px、内容 padding 14px、分组间距 16px。
- 不改变 ACL 或邀请数据库结构，不改评论抽屉和实时协作连接逻辑。
- 复杂业务原因、权限边界和失败降级使用简洁中文注释；直观 JSX 和普通 CRUD 不写注释。
- Commit message 使用中文 `类型(范围): 简述` 格式。
- 用户明确要求本轮暂不运行测试；实现后只做 diff、类型接口和设计稿清单的静态核对，测试在 UI 确认后另补。

---

## File Structure

- `notes-backend/src/modules/notes/notes.service.ts`：组装创建者、ACL 成员公开资料和管理权限。
- `notes-backend/src/modules/invitations/invitations.service.ts`：把邀请列表映射为前端管理所需的安全字段。
- `notes-frontend/src/lib/api/collab.ts`：定义 ACL 与邀请响应类型，去除协作 UI 中的 `any`。
- `notes-frontend/src/components/collab/CollaboratorMemberRow.tsx`：呈现正式成员、待接受邀请、权限菜单与行级 busy 状态。
- `notes-frontend/src/components/collab/CollaboratorsPanel.tsx`：加载数据、合并成员与邀请、发送/重发/撤销/角色修改/移除操作。
- `notes-frontend/src/components/editor/NoteEditorDrawers.tsx`：高保真协作抽屉容器、键盘关闭和参与者透传。
- `notes-frontend/src/components/editor/NoteEditorShell.tsx`：向抽屉传递实时参与者。
- `notes-frontend/src/styles/editor-tokens.css`：设计稿 token、抽屉布局、控件状态、暗色主题和响应式样式。

### Task 1: 提供协作侧栏需要的安全数据

**Files:**
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
- Modify: `notes-backend/src/modules/invitations/invitations.service.ts`
- Modify: `notes-frontend/src/lib/api/collab.ts`

**Interfaces:**
- Produces: `NoteVisibility = 'private' | 'org' | 'public'` and `AclRole = 'owner' | 'editor' | 'viewer' | 'commenter'`
- Produces: `AclResponse = { visibility: NoteVisibility; canManage: boolean; acl: Collaborator[] }`
- Produces: `Collaborator = { userId: string; role: AclRole; displayName?: string; email?: string; avatarUrl?: string }`
- Produces: `InvitationSummary = { id: string; managementToken: string; inviteeEmail?: string; role: 'editor' | 'viewer'; status: string; createdAt: string; expiresAt: string }`

- [ ] **Step 1: 扩展 ACL 查询结果**

在 `getAcl` 中 populate `userId` 与 `acl.userId`，只选择 `_id email displayName avatarUrl`。把创建者放在成员数组首位并标记为 `owner`，其余 ACL 成员保持原角色；通过当前请求用户是否为创建者或 ACL owner 计算 `canManage`。

```ts
type PublicCollaborator = {
  userId: string
  role: 'owner' | 'editor' | 'viewer' | 'commenter'
  displayName?: string
  email?: string
  avatarUrl?: string
}

return { visibility: note.visibility, canManage, acl: members satisfies PublicCollaborator[] }
```

- [ ] **Step 2: 收敛邀请列表字段**

`listForNote` 不直接返回 Mongoose 文档，显式映射 `_id`、`tokenHash`、邮箱、角色、状态与时间。`managementToken` 使用已有 hash，只用于经过 owner 校验的撤销接口，不把原始邀请 token 写回数据库或列表。

```ts
return items.map((invite) => ({
  id: invite._id.toString(),
  managementToken: invite.tokenHash,
  inviteeEmail: invite.inviteeEmail,
  role: invite.role,
  status: invite.status,
  createdAt: invite.createdAt,
  expiresAt: invite.expiresAt,
}))
```

- [ ] **Step 3: 为前端 API 增加精确类型**

在 `collab.ts` 导出 `NoteVisibility`、`AclRole`、`Collaborator`、`AclResponse` 与 `InvitationSummary`，并让 `aclAPI.get`、`invitationsAPI.list`、`create` 返回对应 Promise 类型；保持现有调用签名兼容。历史 `commenter` 在展示层按“只读”呈现，用户主动切换后才写回当前支持的 `viewer` 或 `editor`，不静默改变既有 ACL。

- [ ] **Step 4: 静态核对并提交**

核对响应中不含 password、`canManage` 与后端 owner 判定使用同一权限边界、邀请撤销仍接受 hash。运行 `git diff --check`，不运行测试。

```powershell
git add -- notes-backend/src/modules/notes/notes.service.ts notes-backend/src/modules/invitations/invitations.service.ts notes-frontend/src/lib/api/collab.ts
git commit -m "feat(collab): 补充协作成员展示资料"
```

### Task 2: 实现成员行与协作交互

**Files:**
- Create: `notes-frontend/src/components/collab/CollaboratorMemberRow.tsx`
- Modify: `notes-frontend/src/components/collab/CollaboratorsPanel.tsx`

**Interfaces:**
- Consumes: `Collaborator`、`InvitationSummary`、`AclResponse`
- Produces: `CollaborationParticipant = { id: string; name?: string }`
- Produces: `CollaboratorMemberRow` props containing `kind`, `name`, `meta`, `role`, `online`, `canManage`, `busy`, `onRoleChange`, `onRemove`, `onResend`, `onRevoke`

- [ ] **Step 1: 创建纯呈现成员行组件**

使用 Lucide `ChevronDown`、`Check`，头像优先显示图片并回退到名称首字符。正式成员菜单包含“只读”“可编辑”、分隔线和“移除成员”；待接受菜单包含“重新发送”、分隔线和“撤销邀请”。菜单支持外部点击与 Escape 关闭，busy 时禁用当前行操作。

```tsx
<li className="collab-member" data-busy={busy || undefined}>
  <MemberAvatar name={name} avatarUrl={avatarUrl} online={online} />
  <div className="collab-member__identity">...</div>
  <div className="collab-member__actions">...</div>
  {menuOpen ? <div className="collab-member-menu" role="menu">...</div> : null}
</li>
```

- [ ] **Step 2: 重写数据加载与展示编排**

以 `Promise.allSettled` 加载 ACL 与邀请；ACL 首次失败显示内联重试，邀请权限失败只隐藏邀请管理。正式成员与 `pending` 邀请合并到同一个“成员”分组。当前用户通过 `getStoredUser()` 标记为“我”，展示名称按 `displayName → email → 缩短 userId` 回退。

- [ ] **Step 3: 接入成员权限操作**

角色修改调用 `aclAPI.update`，移除调用 `aclAPI.remove`；每个操作使用稳定 busy key，成功后重新加载 ACL，失败保留现有列表并使用 `appToast.error`。

```ts
await runMemberAction(`member:${userId}`, () => aclAPI.update(noteId, userId, nextRole))
await runMemberAction(`member:${userId}`, () => aclAPI.remove(noteId, userId))
```

- [ ] **Step 4: 接入邀请操作**

发送邀请校验邮箱后调用 `invitationsAPI.create`。重发先创建同邮箱同角色的新邀请，再撤销旧 `managementToken`；撤销失败时刷新并提示部分成功。撤销直接调用 `invitationsAPI.revoke`。所有成功状态使用 toast，不插入设计稿之外的卡片。

- [ ] **Step 5: 静态核对并提交**

确认 `readOnly || !canManage` 时没有写操作入口，owner 行不可编辑，菜单文案全部为中文。运行 `git diff --check`，不运行测试。

```powershell
git add -- notes-frontend/src/components/collab/CollaboratorMemberRow.tsx notes-frontend/src/components/collab/CollaboratorsPanel.tsx
git commit -m "feat(collab): 完善成员与邀请管理交互"
```

### Task 3: 按设计稿重构抽屉和全部视觉状态

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorDrawers.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`

**Interfaces:**
- Consumes: `CollaborationParticipant[]`
- Produces: `NoteEditorDrawers` 新增 `collaborators: CollaborationParticipant[]`

- [ ] **Step 1: 重构协作抽屉 DOM**

移除旧版嵌套卡片、“协作者”二级卡片标题和文字关闭按钮。使用 `Users` 与 `X` 图标构建设计稿标题栏，容器类固定为 `collab-drawer`、`collab-drawer__head`、`collab-drawer__content`。保留评论抽屉 DOM 不变。

- [ ] **Step 2: 传入实时参与者**

在 `NoteEditorShell` 调用 `NoteEditorDrawers` 时传入现有 `participants`；面板用 participant id 集合计算绿点。awareness 正常时列表至少包含当前用户，因此以 `participants.length > 0` 作为在线状态可判定条件：集合中的正式成员显示绿点，其他正式成员显示灰点；数组为空时不显示状态点。

- [ ] **Step 3: 写入设计稿专属 token 和精确样式**

在 `editor-tokens.css` 增加 `--collab-*` 明暗变量以及规格中列出的精确尺寸。关键值必须直接对应：

```css
.collab-drawer { width: min(340px, 100vw); }
.collab-drawer__head { height: 56px; padding: 0 14px 0 16px; }
.collab-drawer__content { padding: 14px; gap: 16px; }
.collab-member { grid-template-columns: 32px 1fr auto; min-height: 48px; padding: 6px 2px; }
.collab-role-trigger { min-width: 72px; height: 30px; border-radius: 999px; }
.collab-invite-form { grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; }
```

完整实现 light/dark、hover、focus、active、disabled、pending、danger、menu shadow 与 `prefers-reduced-motion`。抽屉本体不加圆角和阴影。

- [ ] **Step 4: 补齐弹层键盘行为**

协作抽屉打开时监听 Escape 关闭；遮罩保持点击关闭，关闭按钮有准确 `aria-label`。菜单和表单控件保留可见 focus 样式，视觉尺寸较小的控件不通过改大外观破坏设计稿。

- [ ] **Step 5: 静态核对并提交**

逐项对照设计规格中的数值表和设计稿 DOM，确认评论抽屉无 diff。运行 `git diff --check` 和限定路径 `git diff`，不运行测试、构建或 lint。

```powershell
git add -- notes-frontend/src/components/editor/NoteEditorDrawers.tsx notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/styles/editor-tokens.css
git commit -m "feat(collab): 高保真重构协作侧栏"
```

### Task 4: UI 确认前静态验收

**Files:**
- Review: all files changed in Tasks 1–3

- [ ] **Step 1: 检查范围**

使用 `git diff --name-only <实施前提交>..HEAD`，确认变更仅落在计划列出的协作、编辑器容器、样式和数据响应文件。

- [ ] **Step 2: 检查设计稿覆盖**

按 340px 抽屉、56px 标题栏、三个分组、成员四种状态、邀请三列布局、两个菜单、明暗主题和 150ms 状态过渡逐项核对源代码。

- [ ] **Step 3: 检查未验证声明**

交付时明确说明本轮按用户要求没有运行测试、构建、lint 或浏览器视觉回归，不声明这些检查通过；列出 UI 确认后需要补做的验证。
