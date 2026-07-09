# AI-DevSpace — Frontend Step 2: HTML→React Port Spec

**Status:** ready-for-agent
**Date:** 2026-07-09
**Deciders:** 项目负责人
**Supersedes:** 无（与 [`2026-07-09-frontend-phase0-alignment-design.md`](2026-07-09-frontend-phase0-alignment-design.md) 是承接关系，后者完成 Phase 0 / Step 1；本 spec 覆盖 Step 2）

---

## Goal

把 [`docs/design/pages/`](../../design/README.md) 下 **12 路由 HTML + 3 层叠 HTML（合计 15 份）** 一对一翻译为 React，落入 Next.js 14 App Router 的三层 route group 结构（[ADR-0007](../../adr/0007-workspace-route-group-shell.md) 已锁）：

```
app/
├── layout.tsx                              # 根：仅 <html><body> + ThemeProvider（Step 1 已就位）
├── (workspace)/                            # 产品 group（Step 2 起点）
│   ├── layout.tsx                          # StatusBar + Sidebar + Cmd+K/+/N 监听
│   ├── page.tsx                            # /  → 01 Dashboard
│   ├── requirements/page.tsx               # /requirements  → 02 列表
│   ├── requirements/[id]/layout.tsx        # ResourceTree + Inline 提示栏
│   ├── requirements/[id]/page.tsx          # 03 workspace
│   ├── requirements/[id]/repos/page.tsx    # 04
│   ├── requirements/[id]/artifacts/...     # 05
│   ├── requirements/[id]/history/...       # 06
│   ├── requirements/[id]/settings/...      # 07
│   ├── repos/page.tsx                      # 08
│   ├── repos/[name]/page.tsx               # 09
│   ├── knowledge/page.tsx                  # 10
│   ├── skills/page.tsx                     # 11
│   └── settings/page.tsx                   # 12
└── dev/                                    # dev 自检 group（已存在，prod notFound）
```

`pnpm dev` 跑起后 `localhost:3333` 在浏览器中应当跟 [`docs/design/pages/01-dashboard.html`](../../design/pages/01-dashboard.html) 等 15 份 HTML 视觉稿在视觉上像素级一致（Layout / Typography / Spacing / Color tokens）。

---

## Locked Decisions（继承此前决策，不再讨论）

| 来源 | 决策摘要 |
|---|---|
| [ADR-0005](../../adr/0005-brand-palette-six-step.md) | Brand 6 阶断续（brand / brand-50 / brand-100 / brand-500 / brand-600 / brand-700），非完整 50-900 |
| [ADR-0006](../../adr/0006-html-prototype-as-source-of-truth.md) | 三件套单一对照：PRD.md / UI-POLISH-SPEC.md / docs/design/pages/*.html，12 路由 1:1，3 层叠 overlay；早期 AI-DevSpace-Design.md DEPRECATED |
| [ADR-0007](../../adr/0007-workspace-route-group-shell.md) | workspace shell 三层 group = 根 layout / (workspace) / requirements/[id]；Cmd+K/+/N 监听器归属 (workspace)/layout.tsx |
| [CONTEXT.md](../../../CONTEXT.md) 决策 16-35 | UI 全套（StatusBadge 9 variant、AI 6 状态、Linear 紧凑型、Inter + JetBrains Mono、状态色、Cmd+K 三段式、SSE、@fastify/sse 等） |

**所有 4 件决策直接采纳，不再在 Step 2 范围重排。** 实施 agent 读到本 spec 时默认锁住。

---

## Scope（Step 2 必须交付）

### 12 个路由（1:1 对应 docs/design/pages/）

| # | Route | 视觉对照 | 关键组件 |
|---|---|---|---|
| 01 | `/` | `01-dashboard.html` | StatusBar + Sidebar + StatGrid + RequestCard ×3 + ActiveSessionCard ×2 + InboxItem ×3 |
| 02 | `/requirements` | `02-requirements.html` | StatusBar + Sidebar + RequestList（Linear 紧凑行表）+ 状态筛选 |
| 03 | `/requirements/:id` | `03-requirement-workspace.html` | + ResourceTree（左 240） + Inline 提示栏（右 120，默认折叠） + CenterTabs（Markdown/Diff/文件树/对话） + Markdown view |
| 04 | `/requirements/:id/repos` | `04-requirement-repos.html` | 同 03 壳 + RepoList |
| 05 | `/requirements/:id/artifacts` | `05-requirement-artifacts.html` | 同 03 壳 + ArtifactList（按类型分组：Database/Config/API/Test 等） |
| 06 | `/requirements/:id/history` | `06-requirement-history.html` | 同 03 壳 + 对话历史时间轴 |
| 07 | `/requirements/:id/settings` | `07-requirement-settings.html` | 同 03 壳 + Form（meta.yaml 风格） |
| 08 | `/repos` | `08-repos.html` | StatusBar + Sidebar + 仓库池（卡片） |
| 09 | `/repos/:name` | `09-repo-detail.html` | StatusBar + Sidebar + 仓库详情 + worktree 列表 |
| 10 | `/knowledge` | `10-knowledge.html` | StatusBar + Sidebar + Knowledge 分类（domain/patterns/bugs） |
| 11 | `/skills` | `11-skills.html` | StatusBar + Sidebar + Skill 列表（内置 6 个 + 用户） |
| 12 | `/settings` | `12-settings.html` | StatusBar + Sidebar + 设置面板（主题 / 打字机 / 静默） |

### 3 个 overlay 层叠（键盘触发，不占 route）

| 快捷键 | 组件 | 视觉对照 |
|---|---|---|
| `Cmd+K` | `CommandPalette` | `13-command-palette.html`（三段式：命令/AI 提问/历史） |
| `Cmd+/` | `ShortcutsCheatsheet` | `14-shortcuts-cheatsheet.html` |
| `Cmd+N` | `NewRequirementModal` | `15-new-requirement-modal.html` |

### 共享组件（先抽，后用）

必须先抽出（这些在 ≥2 个页面被复用）：

| 组件 | 复用页面 | HTML 实现来源 |
|---|---|---|
| `StatusBar` | 全部 12 | 01-12 statusbar 区段 |
| `Sidebar` | 全部 12 | 01 sidebar 区段 |
| `ResourceTree` | 03-07 | 03 tree 区段 |
| `InlineRail` | 03-07 | 03 right-rail 区段 |
| `StatusBadge`（9 variant） | 02/03/06/列表/详情 | 01 badge 区段 |
| `AIStatusDot`（6 variant） | StatusBar/详情/活跃会话 | 01 ai-status 区段 |
| `ProgressBar` | 01（req 卡片）/03（详情） | 01 progress 区段 |
| `RequestCard` | 01（home 卡） | 01 req-card 区段 |
| `ActiveSessionCard` | 01（活跃会话） | 01 session 区段 |
| `InboxItem` | 01（待办） | 01 inbox-item 区段 |
| `EmptyState` | 空态 02/05/10 等 | 01 empty 区段 |
| `StatCard` | 01 顶部 4 块 | 01 stat-card 区段 |
| `KeyboardBridge` | (workspace) 全局 | 自实现（监听 Cmd+K/+/N） |
| `CenterTabs`（03 子页） | 03 主工作区 | 03 center-tabs 区段 |

### 已抽但**不重写的复用**

- tokens.css（Step 1 已落）—— Step 2 内部 Task 1 补 Brand 6 阶梯的 `--brand-50/100/600/700` 等
- tailwind config（Step 1 已落）—— 在 Task 1 把 brand 6 阶 mapping 进 tailwind colors.brand
- ThemeSwitcher（Step 1 已落）—— Step 2 不动
- RootLayout + ThemeProvider（Step 1 已落）—— Step 2 不动

---

## Out of Scope（显式排除，列出避免 Plan drift）

| 不做 | 推迟到 |
|---|---|
| 真实 SSE/REST 数据流接入（Step 2 用 mock.ts） | Agent workstream（issue 03 接通后） |
| 真实 Cmd+K 绑当前需求 vs 全局切换 | Step 3（context-aware CommandPalette） |
| shadcn/ui 完整组件库 CLI 接入 | P1+ |
| next/font/google Inter / JetBrains Mono 切换 | P1+（Step 2 用现有 CDN link，与 HTML 原型一致） |
| 国际化 i18n | P1+ |
| 移动端断点响应式 | P1+ |
| 测试框架（Vitest/Playwright） | P2+（视觉验收靠 HTML 对比 + 人工 smoke） |
| AI 打字机流式输入接真 SSE | 与"真实数据流"同步 |
| 后端 Agent 进程（issue 03） | 与 Step 2 并行，独立 plan |
| Storybook + Chromatic 视觉回归 | P2+ |
| 把 HTML 视觉稿重绘为高保真 figma | 不做 |

---

## Acceptance Criteria（验收，dispatch 给 reviewer 用）

### 路由存在性（11 项 — 抽测优先）

```
1.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/                          == 200
2.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/requirements              == 200
3.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/requirements/req-001     == 200
4.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/requirements/req-001/repos      == 200
5.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/requirements/req-001/artifacts  == 200
6.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/requirements/req-001/history    == 200
7.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/requirements/req-001/settings   == 200
8.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/repos                     == 200
9.  curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/repos/refund-service      == 200
10. curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/knowledge                 == 200
11. curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/skills                    == 200
12. curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/settings                  == 200
```

### 视觉对照（人工 smoke — 与 HTML 视觉稿视觉一致）

- [ ] 01 Dashboard：4 stat 卡 + 3 进行中 req 卡 + 2 活跃会话 + 3 待办全部渲染，颜色 / 间距 / 字号 / 圆角 / 阴影与 01-dashboard.html 一致
- [ ] 02 Requirements：列表紧凑行（48px 高度）+ 状态徽章 + 筛选 chips，与 02-requirements.html 一致
- [ ] 03 Workspace：三栏布局（左 240 / 中 1fr / 右 120）+ ResourceTree 各 section + Inline 提示栏折叠态 + Markdown 视图，与 03-requirement-workspace.html 一致
- [ ] 04-07：03 壳 + 各页面 body
- [ ] 08/09：仓库池 + 仓库详情
- [ ] 10/11/12：知识 / Skill / 设置
- [ ] Cmd+K overlay：backdrop + 三段式 + 命令列表，与 13-command-palette.html 一致
- [ ] Cmd+/ overlay：速查面板，与 14-shortcuts-cheatsheet.html 一致
- [ ] Cmd+N overlay：新建需求弹窗，与 15-new-requirement-modal.html 一致

### 主题切换（light / dark / system）

- [ ] ThemeSwitcher 在所有 12 个产品页 + 3 个 overlay 中切换实时响应
- [ ] dark theme 下所有色 token（`--bg`, `--text-1/2/3`, `--border`, `--brand-*`, `--success/warning/error/info`）符合 [tokens.css](../adr/...) 的 light + dark 双套

### 状态徽章 9 variant 渲染（StatusBadge）

- [ ] draft / analyzing / designing / planning / implementing / submitting / done / archived / clarifying 9 个 variant 都能渲染，对应 9 种颜色（draft/archived 灰；analyzing/designing/planning 淡紫；implementing 紫；submitting 黄；done 绿；clarifying 紫 + 警告红角标）

### AI 状态点 6 variant 渲染（AIStatusDot）

- [ ] idle / thinking / tool_calling / writing / awaiting_user / error 6 个 variant 都能渲染，对应动画（thinking bounce、tool_calling spin、awaiting_user pulse-orange、error pulse-red）

### 键盘监听归属隔离

- [ ] 在 `/`、`/requirements`、`/knowledge`、`/settings` 等产品页按 `Cmd+K` 弹出 CommandPalette
- [ ] 在 `/dev/tokens` 按 `Cmd+K` **不弹出** CommandPalette（dev 页面无键盘监听）

### dev 页面隔离

- [ ] `pnpm build` 产出中**无** `/dev/*` 路由
- [ ] `curl http://localhost:3333/dev/tokens` 在 prod build 下返回 404

### 状态机对齐（待 kickoff 时确认）

- Status: ready-for-agent（写 plan 时锁定）→ ready-for-review（实施完成后 reviewer 改）→ accepted（用户最后批准）
- Status 已锁定，从 dispatcher 视角，本 spec 即实施起点

---

## Data Contract（Step 2 用 mock，P1+ 接 Agent SSE）

Step 2 不接真实后端。所有页面用 static mock 数据。位置：`apps/web/src/app/(workspace)/data/mock.ts`，导出：

```typescript
export type RequirementStatus = 'draft' | 'analyzing' | 'designing' | 'planning' | 'implementing' | 'submitting' | 'done' | 'archived' | 'clarifying';

export interface Requirement {
  id: string;             // "req-001"
  title: string;          // "退款功能优化"
  status: RequirementStatus;
  progress: number;       // 0..100
  repos: string[];        // ["refund-service", "order-service"]
  updatedAt: string;      // ISO 8601
  currentStage?: string;  // "design-stage"
  currentTask?: number;   // 12
}

export interface Session {
  id: string;
  requirementId: string;
  title: string;
  aiStatus: 'idle' | 'thinking' | 'tool_calling' | 'writing' | 'awaiting_user' | 'error';
  currentTask?: string;
  filesRead?: number;
  ageMinutes: number;
}

export interface InboxItem {
  id: string;
  kind: 'question' | 'error' | 'todo';
  requirementTitle: string;
  message: string;
  agoMinutes: number;
}

export interface Repository {
  name: string;
  branch: string;
  latestCommit: string;   // hash 前 7 位
  changedFiles: number;
}

export interface Artifact {
  id: string;
  name: string;           // "refund.sql"
  type: 'database' | 'config' | 'api' | 'test' | 'doc' | 'other';
  requirementId: string;
  createdBy: string;      // "design-stage"
  agoMinutes: number;
  size: number;           // bytes
}

// ... and inline mock arrays: requirements[], sessions[], inbox[], repositories[], artifacts[], knowledge[], skills[]
```

真实 Agent SSE 数据流接通时间 = 与 issue 03 (Agent 守护进程骨架) 解锁后；属 P1+ Step。

---

## Dependencies（新增依赖清单 = 空）

Step 2 不引新依赖。Step 1 已就位：

- `next` ^14.2
- `react` ^18.3
- `tailwindcss` ^3.4 + `tailwindcss-animate`
- `next-themes` ^0.3
- `clsx` ^2.1 + `tailwind-merge` ^3.6 + `class-variance-authority` ^0.7
- `@ai-devspace/shared` workspace:*

**Plan dispatcher 必检**：`grep -E '"[a-z-]+":\s*"\^' apps/web/package.json` 输出条目与 Step 1 比对，**只允许**同等条目。

---

## Repo / File Boundaries（实施前必读）

| 路径 | Step 2 后落地的内容 |
|---|---|
| `apps/web/src/app/layout.tsx` | 不动（Step 1 已就位） |
| `apps/web/src/app/(workspace)/layout.tsx` | **新建** Task 2 |
| `apps/web/src/app/(workspace)/page.tsx` | **新建** Task 5（01 dashboard 翻译） |
| `apps/web/src/app/(workspace)/requirements/page.tsx` | **新建** Task 6 |
| `apps/web/src/app/(workspace)/requirements/[id]/layout.tsx` | **新建** Task 3 |
| `apps/web/src/app/(workspace)/requirements/[id]/{page,repos,artifacts,history,settings}/page.tsx` | **新建** Task 7 |
| `apps/web/src/app/(workspace)/{repos,knowledge,skills,settings}/...` | **新建** Task 8 |
| `apps/web/src/app/(workspace)/data/mock.ts` | **新建** Task 2（起始） / 各 page 增量补 |
| `apps/web/src/components/` | **新建**（Step 2 全程） |
| `apps/web/src/styles/tokens.css` | Task 1 补 brand-50/100/600/700 阶梯 |
| `apps/web/tailwind.config.ts` | Task 1 加 colors.brand 映射（继承 tokens.css） |
| `apps/web/src/app/dev/tokens/{layout,page}.tsx` | 不动（Step 1 已就位） |

---

## Self-review Trail（本 spec 已通过 1 次作者自审）

- spec coverage ✅：12 路由 + 3 overlay + 共享组件 + 数据契约 + 验收 + 不引依赖 全部覆盖
- type consistency ✅：data mock.ts 的 type 列表与组件 props 对应（与 Task 4/5/6/7/8 接口对应）
- placeholder scan ✅：无 TBD / TODO / "implement later"

---

## Status: ready-for-agent

Plan 即将并列写到 `docs/superpowers/plans/2026-07-09-frontend-step2-html-port.md`。Dispatcher 直接执行。
