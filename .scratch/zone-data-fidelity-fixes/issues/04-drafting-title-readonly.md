---
Status: ready-for-agent
Type: ticket
Parent: ../PRD.md
Related-ADRs: [ADR-0002, ADR-0011]
Blocked-by: []
---

# 04 — DRAFTING 标题 UI 只读化 + validateLaunch 去 title 必填

**What to build:** 移除 DRAFTING 工作台里的"标题"输入框(标题在新建需求时已由 `NewRequirementModal` 写入 `meta.yaml.title`,列表页 / 面包屑 / 只读 hero 都用它,不让用户在 drafting 里再编辑一遍),换成只读 hero 区显示当前需求标题。同时把共享包 `validateLaunch` 的签名从 `{ title, prdMarkdown }` 收窄为 `{ prdMarkdown }`,让"进入 ANALYZING"按钮只看 PRD 是否实质有内容——避免用户在 PRD 写好后因忘记填标题被卡住流程的隐藏耦合。本 ticket 完成后,bug 4(标题冗余 + 启动卡 title)消失。

**Blocked by:** None — 完全独立,可跟 01/02/03 任何阶段并行(不与 page.tsx 或 server-only loader 改任何文件冲突)。

## Acceptance criteria

### 组件层

- [ ] `apps/web/src/components/drafting-prd-pane.tsx`:
  - 删 `:247-262` 行 `<input data-testid="drafting-title">` 输入框 JSX
  - 替换为只读 hero 区:大字号(`text-2xl font-bold` 级别)显示 `data.title`,下方灰色副标题"你在写这个需求"
  - `DraftingPrdPaneProps` 删 `title` / `onTitleChange` 字段
  - 删 `:149` `generatePrdSkeleton(data.title || title)` 调用里的 `title` fallback
- [ ] `apps/web/src/components/drafting-zone.tsx`:
  - 删 `:107` `const [title, setTitle] = useState<string>(data.title)`
  - 删 `:210-220` 里 `setTitle(data.title)` 的同步逻辑
  - 删 `:763-771` 传给 `DraftingPrdPane` 的 `title` / `onTitleChange` props
  - `:198` `launchDisabledHint` 文案统一为"请填写 PRD Markdown"(去掉"请填写标题与…"分支)
  - `:188` `validateLaunch` 调用改成 `validateLaunch({ prdMarkdown })`

### 共享包

- [ ] `packages/shared/src/drafting.ts`:
  - `validateLaunch` 签名:`{ title: string; prdMarkdown: string }` → `{ prdMarkdown: string }`
  - 实现:`canLaunch = input.prdMarkdown.trim().length > 0`
  - `LaunchValidity` 接口不变
  - `generatePrdSkeleton(title)` 函数不变(只读 hero 不需要)

### 数据契约

- [ ] `DraftingData.title` 字段**保留**(只读 hero / 列表页 / 面包屑都依赖)
- [ ] `REFUND_DRAFTING.title` / `emptyDrafting.title` 不动
- [ ] `drafting.server.ts`(01 ticket 新建)的 `getDraftingDataFromFs` 返回 data 时,**保留 title 字段**(从 `meta.yaml.title` 读,或暂用 reqId 兜底——具体由 01 ticket 实现决定)

### 测试

- [ ] `packages/shared/src/__tests__/drafting.test.ts`(新建或更新):
  - `validateLaunch({ prdMarkdown: '' })` → `canLaunch: false`
  - `validateLaunch({ prdMarkdown: '   \n   ' })` → `canLaunch: false`
  - `validateLaunch({ prdMarkdown: '# foo\nbar' })` → `canLaunch: true`
  - 类型守护:传入 `{ title: 'x', prdMarkdown: 'y' }` 必须编译失败(`title` 已不再是合法字段)
- [ ] `apps/web/src/__tests__/drafting-zone.test.tsx`(更新):
  - 断言 `data-testid="drafting-title"` **不存在**(`queryByTestId('drafting-title')` 返回 null)
  - 断言只读 hero 区显示 `data.title`(可用 `getByText(data.title)` 验证)
  - 断言 `prdMarkdown === ''` 时 launchDisabledHint === '请填写 PRD Markdown'
- [ ] `pnpm --filter web typecheck && pnpm --filter web test` 全套绿。

### 文档

- [ ] `packages/shared/src/drafting.ts` 的 `validateLaunch` JSDoc 注释:删 "title 与 prdMarkdown 各自 trim 后均非空",改成"prdMarkdown trim 后非空"。