# 编辑器浏览器验收 transcript（脱敏）

## 环境前置

- 工具：agent-browser 0.27.0，Chromium。
- writer 会话：`task7fix-u1`；viewer 会话：`task7fix-u2`。
- 前置：从本 worktree 分别在 `notes-frontend` 执行 `npm.cmd run dev`、在 `notes-backend` 执行 `npm.cmd run dev`、在 `y-websocket` 执行 `npm.cmd run start`；这些服务在验收前已经按仓库 scripts 启动，本轮不重启。
- `task7fix-u1` 与 `task7fix-u2` 必须已完成登录，以下命令不包含登录步骤。
- `$env:TASK7_NOTE_URL` 在本地会话中预先赋值为目标笔记 URL；命令不回显登录信息或请求机密。
- 本文记录 Fix round 1 已执行的命令与输出。Fix round 2 没有重新启动服务或浏览器。

## writer：1440×900 轨道、键盘与保存

```powershell
agent-browser --session task7fix-u1 set viewport 1440 900
agent-browser --session task7fix-u1 open $env:TASK7_NOTE_URL
agent-browser --session task7fix-u1 eval '(() => { const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}}; const g=document.querySelector(".editor-layout-grid"); return {viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},columns:getComputedStyle(g).gridTemplateColumns,grid:rect(".editor-layout-grid"),main:rect(".editor-layout-main"),toolbar:rect(".editor-toolbar")}; })()'
```

首次 eval 的已保存关键输出：`columns="280px 558px 240px"`、grid width `1078`、main rect width `558`。原始记录没有保留 document 与 toolbar 的完整对象值；上述同一条 eval 会在复跑时一并返回它们，未保留的值不在本文补造。

按 aria name 收起左右栏并读取同一组几何值：

```powershell
agent-browser --session task7fix-u1 click '[aria-label="收起左侧导航"]'
agent-browser --session task7fix-u1 click '[aria-label="收起右侧面板"]'
agent-browser --session task7fix-u1 eval '(() => { const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}}; const g=document.querySelector(".editor-layout-grid"); return {viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},columns:getComputedStyle(g).gridTemplateColumns,grid:rect(".editor-layout-grid"),main:rect(".editor-layout-main"),toolbar:rect(".editor-toolbar")}; })()'
```

折叠后已保存关键输出：`columns="52px 974px 52px"`、grid width `1078`、main rect width `974`。此处正文 main rect 的实际折叠前后值为 `558 → 974`，不是固定视口减法；document/toolbar 完整对象同样仅在复跑时由命令返回，原始记录未保留的字段保持未记录。

```powershell
agent-browser --session task7fix-u1 focus '[aria-label="展开左侧导航"]'
agent-browser --session task7fix-u1 press Enter
agent-browser --session task7fix-u1 eval 'getComputedStyle(document.querySelector(".editor-layout-grid")).gridTemplateColumns'
```

输出：`"280px 746px 52px"`。

```powershell
agent-browser --session task7fix-u1 focus '[aria-label="展开右侧面板"]'
agent-browser --session task7fix-u1 press Space
agent-browser --session task7fix-u1 eval '(() => { const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}}; const g=document.querySelector(".editor-layout-grid"); return {columns:getComputedStyle(g).gridTemplateColumns,main:rect(".editor-layout-main"),toolbar:rect(".editor-toolbar"),document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}}; })()'
```

关键输出：`columns="280px 558px 240px"`、main rect width `558`。左右栏状态均已恢复。

```powershell
agent-browser --session task7fix-u1 network requests --clear
agent-browser --session task7fix-u1 focus '.ProseMirror'
agent-browser --session task7fix-u1 press Control+End
agent-browser --session task7fix-u1 type '.ProseMirror' ' Task7 autosave probe'
agent-browser --session task7fix-u1 wait 3000
agent-browser --session task7fix-u1 network requests
```

动态结果：目标笔记 PUT count = `1`，HTTP `200`；另有预检与锁相关流量，不计入笔记 PUT count。页面显示“已自动保存”。

截图：`writer-collapsed-saved-1440-redacted.png`。

## writer：offline autosave

```powershell
agent-browser --session task7fix-u1 network requests --clear
agent-browser --session task7fix-u1 set offline true
agent-browser --session task7fix-u1 type '.ProseMirror' ' offline probe'
agent-browser --session task7fix-u1 wait 2400
agent-browser --session task7fix-u1 eval '({onLine:navigator.onLine, local:document.body.innerText.includes("已保存到本地")})'
agent-browser --session task7fix-u1 network requests
```

输出：`{"onLine":false,"local":true}`；requests count = `0`。

```powershell
agent-browser --session task7fix-u1 set offline false
agent-browser --session task7fix-u1 wait 3000
agent-browser --session task7fix-u1 eval '({onLine:navigator.onLine, saved:document.body.innerText.includes("已自动保存")})'
agent-browser --session task7fix-u1 network requests
```

输出：`{"onLine":true,"saved":true}`；目标笔记 PUT count = `1`，HTTP `200`。

## viewer：只读与零写请求

```powershell
agent-browser --session task7fix-u2 set viewport 1440 900
agent-browser --session task7fix-u2 open $env:TASK7_NOTE_URL
agent-browser --session task7fix-u2 network requests --clear
agent-browser --session task7fix-u2 eval '(() => { document.dispatchEvent(new CustomEvent("editor:setContent",{detail:{content:"viewer-probe"}})); document.dispatchEvent(new CustomEvent("tiptap:exec",{detail:{cmd:"save"}})); const buttons=[...document.querySelectorAll(".editor-toolbar button")]; return {editable:document.querySelector(".ProseMirror")?.getAttribute("contenteditable"),probe:document.querySelector(".ProseMirror")?.textContent?.includes("viewer-probe"),disabled:buttons.filter(b=>b.disabled).length,total:buttons.length}; })()'
agent-browser --session task7fix-u2 press Control+s
agent-browser --session task7fix-u2 wait 1000
agent-browser --session task7fix-u2 network requests
```

动态输出：`{"editable":"false","probe":false,"disabled":25,"total":27}`；`No requests captured`，写请求 count = `0`。

截图：`viewer-readonly-1440-redacted.png`。

## writer：960×900 几何与 reduced motion

```powershell
agent-browser --session task7fix-u1 set viewport 960 900
agent-browser --session task7fix-u1 eval 'localStorage.removeItem("notes:editor-layout:v1")'
agent-browser --session task7fix-u1 reload
agent-browser --session task7fix-u1 eval '(() => { const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}}; return {document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},grid:rect(".editor-layout-grid"),main:rect(".editor-layout-main"),toolbar:rect(".editor-toolbar"),tools:rect(".editor-toolbar__tools"),paper:rect(".editor-paper"),rightCollapsed:document.querySelector(".editor-layout-grid").dataset.rightCollapsed,columns:getComputedStyle(document.querySelector(".editor-layout-grid")).gridTemplateColumns}; })()'
```

动态输出：

```json
{
  "document":{"scrollWidth":952,"clientWidth":952},
  "grid":{"left":49,"right":903,"width":854,"scrollWidth":854,"clientWidth":854},
  "main":{"left":49,"right":903,"width":854,"scrollWidth":854,"clientWidth":854},
  "toolbar":{"left":49,"right":903,"width":854,"scrollWidth":854,"clientWidth":854},
  "tools":{"left":71,"right":617.4375,"width":546.4375,"scrollWidth":592,"clientWidth":546},
  "paper":{"left":83,"right":869,"width":786,"scrollWidth":784,"clientWidth":784},
  "rightCollapsed":"true",
  "columns":"854px"
}
```

tooltip action rect：评论 `left=777,right=809`；协作 `left=813,right=845`，均在 viewport 内。

```powershell
agent-browser --session task7fix-u1 set media light reduced-motion
agent-browser --session task7fix-u1 eval '(() => ({matches:matchMedia("(prefers-reduced-motion: reduce)").matches,left:getComputedStyle(document.querySelector(".editor-left-navigation")).transitionDuration,right:getComputedStyle(document.querySelector(".editor-right-metadata")).transitionDuration,tooltip:getComputedStyle(document.querySelector(".editor-tooltip"),"::after").transitionDuration}))()'
```

输出：`{"matches":true,"left":"0s","right":"0s","tooltip":"0s"}`。

截图：`writer-responsive-960-redacted.png`。

## 未验证

- y-websocket 真实断线到重连成功的完整浏览器链路。
- AI 请求失败到“重试生成”的完整浏览器链路。
- 两个浏览器同时在线的实时内容同步与移动真机。

这些项只存在自动化覆盖或缺少可信运行环境，均未记为浏览器 PASS。
