# Frontend Step 2: HTML→React Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 [`docs/design/pages/`](../../design/README.md) 12 路由 + 3 层叠 HTML 一对一翻译成 React，落入 Next.js 14 App Router 三层 route group（[ADR-0007](../../adr/0007-workspace-route-group-shell.md)）。`pnpm dev` 起 localhost:3333，浏览器所有 12 路由 + 3 overlay 视觉上与各 HTML 视觉稿一致。

**Architecture:** 拆"地基 → shell → 共享组件 → 页面翻译 → overlay"五层。Task 1 锁 Brand 6 阶梯到 tokens.css + tailwind；Task 2/3 落地 (workspace)/(workspace)/requirements/[id] 两层 layout 壳与 StatusBar / Sidebar / ResourceTree / InlineRail / KeyboardBridge；Task 4 抽共享组件库；Task 5/6/7/8 翻 12 路由 (按"主页 → 列表 → 详情组 → 其他"顺序)；Task 9 翻 3 层叠 overlay。每层 task 独立可测、可独立 commit；后续 task 复用前置 task 抽出的组件。

**Tech Stack:** Next.js 14 App Router · React 18 · TypeScript 5.4 · Tailwind CSS 3.4 + tailwindcss-animate · next-themes 0.3 · clsx + tailwind-merge + class-variance-authority · `@ai-devspace/shared` workspace · Inter + JetBrains Mono (HTML 原型用 CDN `<link>`，Step 2 沿用)

---

## Global Constraints（一字不可改，源自 spec + CONTEXT.md + ADR）

- **Brand palette = 6 阶**（[ADR-0005](../../adr/0005-brand-palette-six-step.md)）：`--brand / --brand-50 / --brand-100 / --brand-500 / --brand-600 / --brand-700`，**不**完整 50-900。
- **三件套单一对照**（[ADR-0006](../../adr/0006-html-prototype-as-source-of-truth.md)）：PRD + UI-POLISH-SPEC + docs/design/pages/*.html。实现任何 UI 必须先 Read 对应 HTML 视觉稿作为基线。
- **三层 group**（[ADR-0007](../../adr/0007-workspace-route-group-shell.md)）：根 `app/layout.tsx`（不动）→ `(workspace)/layout.tsx` 包 StatusBar + Sidebar + 键盘监听 → `(workspace)/requirements/[id]/layout.tsx` 包 ResourceTree + InlineRail。
- **键盘监听归属 (workspace)/layout.tsx**：`Cmd+K` → CommandPalette · `Cmd+N` → NewRequirementModal · `Cmd+/` → ShortcutsCheatsheet。`Cmd+Shift+K` 切换当前需求/全局 binding 在 Step 3，本 Step 不实现。
- **StatusBadge 9 variant**：`draft / analyzing / designing / planning / implementing / submitting / done / archived / clarifying`（clarifying 紫 + 红警告角标）。
- **AIStatusDot 6 variant**：`idle / thinking / tool_calling / writing / awaiting_user / error`（每 variant 对应动画）。
- **不引新依赖**：本 plan 不增 npm 依赖；包清单与 Step 1 一致（[apps/web/package.json](../../../apps/web/package.json)）。
- **数据流 = mock**：所有页面从 `apps/web/src/app/(workspace)/data/mock.ts` 读静态数据；真实 SSE 接通在 issue 03 之后。
- **dev group 不污染**：`/dev/tokens` 路径维持 prod notFound；键盘监听**不**挂到 dev。
- **commit message 中文**：沿用 Step 1 风格（`feat(web): ...`）。
- **平台要求**：Windows 用 `corepack pnpm ...`（见 handoff 第 86 行）。
- **不进 handoff 禁止区**：spec 显式排除的所有条目（见 spec § Out of Scope）。

---

## File Structure（本 plan 落地后）

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                                    # 不动（Step 1 已就位）
│   │   ├── page.tsx                                      # 不动（仍为 Step 1 smoke test，作为备份不被 (workspace)/page.tsx 覆盖）
│   │   ├── dev/tokens/{layout,page}.tsx                  # 不动
│   │   └── (workspace)/                                  # ★ Task 2 起建
│   │       ├── layout.tsx                                # ★
│   │       ├── page.tsx                                  # ★ Task 5
│   │       ├── requirements/
│   │       │   ├── page.tsx                              # ★ Task 6
│   │       │   └── [id]/
│   │       │       ├── layout.tsx                        # ★ Task 3
│   │       │       ├── page.tsx                          # ★ Task 7 (03 工作区)
│   │       │       ├── repos/page.tsx                    # ★ Task 7 (04)
│   │       │       ├── artifacts/page.tsx                # ★ Task 7 (05)
│   │       │       ├── history/page.tsx                  # ★ Task 7 (06)
│   │       │       └── settings/page.tsx                 # ★ Task 7 (07)
│   │       ├── repos/page.tsx                            # ★ Task 8 (08)
│   │       ├── repos/[name]/page.tsx                     # ★ Task 8 (09)
│   │       ├── knowledge/page.tsx                        # ★ Task 8 (10)
│   │       ├── skills/page.tsx                           # ★ Task 8 (11)
│   │       ├── settings/page.tsx                         # ★ Task 8 (12)
│   │       └── data/mock.ts                              # ★ Task 2 起 + 各 task 增量
│   ├── components/                                       # ★ Task 2/4
│   │   ├── statusbar.tsx
│   │   ├── sidebar.tsx
│   │   ├── resource-tree.tsx
│   │   ├── inline-rail.tsx
│   │   ├── keyboard-bridge.tsx
│   │   ├── status-badge.tsx
│   │   ├── ai-status-dot.tsx
│   │   ├── progress-bar.tsx
│   │   ├── request-card.tsx
│   │   ├── active-session-card.tsx
│   │   ├── inbox-item.tsx
│   │   ├── empty-state.tsx
│   │   ├── stat-card.tsx
│   │   ├── center-tabs.tsx
│   │   ├── command-palette.tsx                           # ★ Task 9
│   │   ├── shortcuts-cheatsheet.tsx                      # ★ Task 9
│   │   └── new-requirement-modal.tsx                     # ★ Task 9
│   └── styles/tokens.css                                 # Task 1 补 Brand 6 阶梯
```

每个文件单一职责，分层清晰。

---

## Task 1: Brand 6 阶梯补到 tokens.css + tailwind mapping

**Files:**
- Modify: [`apps/web/src/styles/tokens.css`](../../../apps/web/src/styles/tokens.css):62-89 (light `--primary` 段后) 与 91-113 (dark 段后)
- Modify: [`apps/web/tailwind.config.ts`](../../../apps/web/tailwind.config.ts): colors.brand

**Interfaces:**
- Consumes: 当前 `tokens.css` 与 `tailwind.config.ts`（Step 1 状态）
- Produces: 给后续 Task 2/3/4/5/6/7/8/9 用的 CSS variables：CSS class `bg-brand / bg-brand-50 / bg-brand-100 / bg-brand-500 / bg-brand-600 / bg-brand-700` 与 `text-brand-*` 同理

- [ ] **Step 1: 在 `tokens.css` light 段（`/^* light (default) *^/`）第 74 行后插入 Brand 6 阶梯**

插入位置：第 74 行 `--primary:               234 56% 60%;          /* #5e6ad2 */` 后，第 75 行 `--primary-foreground:   0 0% 100%;` 前。

```css
  /* Brand 6 阶（ADR-0005） */
  --brand:               234 56% 60%;          /* 别名，与 500 同值 */
  --brand-50:            234 100% 96%;
  --brand-100:           234 90% 90%;
  --brand-500:           234 56% 60%;          /* #5e6ad2，与 --primary 同值 */
  --brand-600:           234 56% 53%;          /* hover */
  --brand-700:           234 50% 46%;          /* active 前色 */
```

- [ ] **Step 2: 在 `.dark` 段（`/.dark {/^* dark *^/`）第 98 行 `--primary:               234 70% 70%;` 后插入对应 dark 版**

```css
  /* Brand 6 阶（dark） */
  --brand:               234 70% 70%;
  --brand-50:            234 50% 16%;
  --brand-100:           234 50% 22%;
  --brand-500:           234 70% 70%;          /* #7c87e8，与 --primary 同值 */
  --brand-600:           234 75% 76%;
  --brand-700:           234 80% 84%;
```

- [ ] **Step 3: 在 `tailwind.config.ts` 加 `theme.extend.colors.brand`**

读 `apps/web/tailwind.config.ts`，在 `theme.extend.colors` 字段下加：

```ts
brand: {
  DEFAULT: 'hsl(var(--brand))',
  50: 'hsl(var(--brand-50))',
  100: 'hsl(var(--brand-100))',
  500: 'hsl(var(--brand-500))',
  600: 'hsl(var(--brand-600))',
  700: 'hsl(var(--brand-700))',
},
```

- [ ] **Step 4: 验证**

```bash
corepack pnpm --filter @ai-devspace/web dev &
```

打开 `http://localhost:3333/dev/tokens`，在 DevTools Elements 选中 `:root`，应看到 `--brand-50 / -100 / -500 / -600 / -700` 全有 HSL 值。

Expected: 6 个变量在 `:root` 与 `.dark` 都有定义。

- [ ] **Step 5: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/styles/tokens.css apps/web/tailwind.config.ts
git commit -m "feat(web): 加 brand 6 阶梯 tokens 与 tailwind 映射（ADR-0005）"
```

---

## Task 2: workspace shell — (workspace)/layout.tsx + StatusBar + Sidebar + KeyboardBridge 占位

**Files:**
- Create: `apps/web/src/app/(workspace)/layout.tsx`
- Create: `apps/web/src/app/(workspace)/data/mock.ts` (Task 2 初始版本，含 requirement stub 与 sessions/inbox stub)
- Create: `apps/web/src/components/keyboard-bridge.tsx` (client component；监听器注册 + state)
- Create: `apps/web/src/components/statusbar.tsx`
- Create: `apps/web/src/components/sidebar.tsx`
- Create: `apps/web/src/app/(workspace)/page.tsx` (Task 2 版本 = 占位；Task 5 替换)

**Interfaces:**
- Produces (被后续 task 消费):
  - `<StatusBar tabs={Requirement[]} currentId={string} aiStatus={AIStatus} />`
  - `<Sidebar currentPath={string} />`
  - `KeyboardBridge` 暴露 `useCommandPalette()` / `useNewRequirementModal()` / `useShortcutsCheatsheet()` hooks（Task 9 才正式用，Task 2 占位 throw "not yet"）

- [ ] **Step 1: 创建 mock 数据**

写 `apps/web/src/app/(workspace)/data/mock.ts`：

```typescript
export type RequirementStatus =
  | 'draft' | 'analyzing' | 'designing' | 'planning'
  | 'implementing' | 'submitting' | 'done' | 'archived' | 'clarifying';

export type AIStatus =
  | 'idle' | 'thinking' | 'tool_calling'
  | 'writing' | 'awaiting_user' | 'error';

export interface Requirement {
  id: string;
  title: string;
  status: RequirementStatus;
  progress: number;
  repos: string[];
  updatedAt: string;
  currentStage?: string;
  currentTask?: number;
}

export interface Session { id: string; requirementId: string; title: string; aiStatus: AIStatus; currentTask?: string; filesRead?: number; ageMinutes: number; }
export interface InboxItem { id: string; kind: 'question' | 'error' | 'todo'; requirementTitle: string; message: string; agoMinutes: number; }
export interface Repository { name: string; branch: string; latestCommit: string; changedFiles: number; }
export interface Artifact { id: string; name: string; type: 'database' | 'config' | 'api' | 'test' | 'doc' | 'other'; requirementId: string; createdBy: string; agoMinutes: number; size: number; }

// mock 集合（Step 2 内增长；P1+ 改 SSE 接入）
export const requirements: Requirement[] = [
  { id: 'req-001', title: '退款功能优化', status: 'implementing', progress: 62, repos: ['refund-service', 'order-service'], updatedAt: '2026-07-09T15:00:00Z', currentStage: 'code-stage', currentTask: 12 },
  { id: 'req-002', title: '会员等级体系重构', status: 'clarifying', progress: 25, repos: ['member-service'], updatedAt: '2026-07-08T18:00:00Z', currentStage: 'analyze-stage' },
  { id: 'req-003', title: '支付链路灰度切流', status: 'designing', progress: 38, repos: ['pay-gateway', 'risk-service'], updatedAt: '2026-07-09T11:00:00Z', currentStage: 'design-stage' },
];

export const sessions: Session[] = [
  { id: 'sess-1', requirementId: 'req-001', title: '退款功能 · 实施中', aiStatus: 'thinking', currentTask: 'code-stage · Task #12 退款接口开发', filesRead: 8, ageMinutes: 0 },
  { id: 'sess-2', requirementId: 'req-002', title: '会员等级 · 待澄清', aiStatus: 'awaiting_user', currentTask: 'analyze-stage · 已生成 4 个问题', ageMinutes: 60 },
];

export const inbox: InboxItem[] = [
  { id: 'i-1', kind: 'question', requirementTitle: '退款功能', message: '退款失败时是否要回滚已扣减的优惠券额度？目前 code-stage 阻塞在这里', agoMinutes: 2 },
  { id: 'i-2', kind: 'error', requirementTitle: '支付链路灰度切流', message: 'SDK 调用失败：Anthropic API 502，Agent 已自动重试 2 次', agoMinutes: 15 },
  { id: 'i-3', kind: 'question', requirementTitle: '会员等级', message: '黄金会员的成长值是否继承历史等级？需要业务确认', agoMinutes: 60 },
];

export const repositories: Repository[] = [
  { name: 'refund-service', branch: 'feature/refund-optimize', latestCommit: 'abc1234', changedFiles: 12 },
  { name: 'order-service', branch: 'main', latestCommit: 'def5678', changedFiles: 0 },
  { name: 'pay-gateway', branch: 'feature/gray-payment', latestCommit: '9ab12cd', changedFiles: 7 },
];

export const artifacts: Artifact[] = [
  { id: 'a-1', name: 'refund.sql', type: 'database', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 240, size: 4200 },
  { id: 'a-2', name: 'refund-api.yaml', type: 'api', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 220, size: 8400 },
  { id: 'a-3', name: 'apollo.yaml', type: 'config', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 200, size: 1100 },
];
```

- [ ] **Step 2: 创建 `keyboard-bridge.tsx` (client component；占位实现)**

```tsx
'use client';
import { useEffect } from 'react';

// Task 9 起接入真实 CommandPalette / NewRequirementModal / ShortcutsCheatsheet
// 本 task 仅注册键盘监听 + 写 console.log 占位
export function KeyboardBridge() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        console.log('[KeyboardBridge] Cmd+K -> CommandPalette (Task 9)');
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        console.log('[KeyboardBridge] Cmd+N -> NewRequirementModal (Task 9)');
      }
      if (e.key === '/') {
        e.preventDefault();
        console.log('[KeyboardBridge] Cmd+/ -> ShortcutsCheatsheet (Task 9)');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
```

- [ ] **Step 3: 创建 `statusbar.tsx`**

```tsx
import type { Requirement, AIStatus } from '@/app/(workspace)/data/mock';

interface Props {
  tabs: Requirement[]; // 当前工作空间的需求集
  currentId: string | null;
  aiStatus: AIStatus;
}

const STATUS_TO_LABEL: Record<AIStatus, string> = {
  idle: '空闲',
  thinking: '思考中',
  tool_calling: '工具调用中',
  writing: '正在写入',
  awaiting_user: '等待回答',
  error: '错误',
};

export function StatusBar({ tabs, currentId, aiStatus }: Props) {
  const current = tabs.find(t => t.id === currentId);
  return (
    <header className="sticky top-0 z-50 bg-bg-elevated border-b border-border">
      <div className="flex items-center h-10 px-4 gap-0.5 overflow-x-auto">
        {tabs.map(t => (
          <div key={t.id} className={`flex items-center gap-2 h-7 px-3 text-sm rounded-md cursor-pointer whitespace-nowrap
            ${t.id === currentId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-2 hover:bg-bg-subtle'}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background:
              t.status === 'implementing' ? 'var(--brand)' :
              t.status === 'clarifying' ? 'var(--warning)' :
              t.status === 'done' ? 'var(--success)' : 'var(--info)' }} />
            {t.title} · {t.status}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between h-8 px-4 border-t border-border bg-bg-subtle text-sm text-text-2">
        <div className="flex items-center gap-3">
          {current && <>
            <strong className="text-text-1 font-medium">{current.title}</strong>
            <span className="text-text-3">·</span>
            <span>{current.currentStage ?? current.status}</span>
            {current.currentTask && <>
              <span className="text-text-3">·</span>
              <span>Task #{current.currentTask}</span>
            </>}
          </>}
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              aiStatus === 'thinking' ? 'bg-brand animate-pulse' :
              aiStatus === 'tool_calling' ? 'bg-brand animate-spin' :
              aiStatus === 'error' ? 'bg-error animate-pulse' :
              'bg-text-3'
            }`} />
            {STATUS_TO_LABEL[aiStatus]}
          </span>
          <span className="text-text-3 text-xs">⌘K 命令</span>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 创建 `sidebar.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/',         label: '概览',  icon: '🏠', key: '1' },
  { href: '/requirements', label: '需求', icon: '📌', key: '2' },
  { href: '/repos',    label: '仓库',  icon: '📦', key: '3' },
  { href: '/knowledge', label: '知识库', icon: '📚', key: '4' },
  { href: '/skills',   label: 'Skill', icon: '🤖', key: '5' },
  { href: '/settings', label: '设置',  icon: '⚙️', key: '6' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col items-center py-3 gap-0.5 bg-bg-elevated border-r border-border w-14">
      <div className="w-8 h-8 rounded-md bg-brand text-white flex items-center justify-center font-semibold mb-3">A</div>
      {NAV.slice(0, 5).map(n => {
        const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
        return (
          <Link key={n.href} href={n.href}
            aria-label={n.label} title={`${n.label} (⌘${n.key})`}
            className={`w-10 h-10 flex items-center justify-center rounded-md text-lg relative
              ${active ? 'bg-brand-50 text-brand-700 before:absolute before:left-[-12px] before:top-2 before:bottom-2 before:w-0.5 before:bg-brand before:rounded-sm' : 'text-text-2 hover:bg-bg-subtle hover:text-text-1'}`}>
            {n.icon}
          </Link>
        );
      })}
      <div className="flex-1" />
      <Link href="/settings" aria-label="设置" title="设置 (⌘6)"
        className={`w-10 h-10 flex items-center justify-center rounded-md text-lg ${pathname.startsWith('/settings') ? 'bg-brand-50 text-brand-700' : 'text-text-2 hover:bg-bg-subtle hover:text-text-1'}`}>
        ⚙️
      </Link>
    </nav>
  );
}
```

- [ ] **Step 5: 创建 `(workspace)/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import { StatusBar } from '@/components/statusbar';
import { Sidebar } from '@/components/sidebar';
import { KeyboardBridge } from '@/components/keyboard-bridge';
import { requirements } from '@/app/(workspace)/data/mock';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Task 5 接真实数据；Task 2 mock：以 req-001 为 current
  return (
    <div className="min-h-screen flex flex-col">
      <KeyboardBridge />
      <StatusBar tabs={requirements} currentId="req-001" aiStatus="thinking" />
      <div className="flex-1 grid grid-cols-[56px_1fr]">
        <Sidebar />
        <main className="overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 创建 `(workspace)/page.tsx` 占位**

```tsx
export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">概览</h1>
      <p className="text-sm text-text-2 mb-6">
        当前 5 个进行中需求，2 个 AI 会话活跃。完整页面由 Task 5 实现。
      </p>
      <div className="border border-dashed border-border-strong rounded-lg p-12 text-center text-text-3">
        Step 2 · workspace shell 已就位 · 主页待 Task 5 翻译 docs/design/pages/01-dashboard.html
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 验证**

```bash
corepack pnpm --filter @ai-devspace/web dev &
```

- 打开 `http://localhost:3333`：
  - 顶部出现 StatusBar，左侧出现 Sidebar，主区出现 Step 2 占位文案
  - 按 `Cmd+K`：DevTools console 应看到 `[KeyboardBridge] Cmd+K -> CommandPalette (Task 9)`
  - 按 `Cmd+N`：console 应看到 `[KeyboardBridge] Cmd+N -> NewRequirementModal (Task 9)`
  - 打开 DevTools Elements `:root`，确认 `--brand / -50 / -100 / -500 / -600 / -700` 都已就位
- 打开 `http://localhost:3333/dev/tokens`：仍为 Step 1 检视页；按 `Cmd+K` **不**触发 console log（验证键盘监听仅在 (workspace) 生效）

- [ ] **Step 8: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/app/\(workspace\)
git commit -m "feat(web): 加 (workspace) shell 与 StatusBar + Sidebar + KeyboardBridge"
```

---

## Task 3: 第三层 (workspace)/requirements/[id]/layout.tsx + ResourceTree + InlineRail

**Files:**
- Create: `apps/web/src/app/(workspace)/requirements/[id]/layout.tsx`
- Create: `apps/web/src/components/resource-tree.tsx`
- Create: `apps/web/src/components/inline-rail.tsx`
- Create: `apps/web/src/components/center-tabs.tsx`（Task 7 复用，本 task 仅建组件骨架）

**Interfaces:**
- Produces:
  - `<ResourceTree requirementId={string} activePath={string} />`（左侧 240px 资源树）
  - `<InlineRail requirementId={string} />`（右侧 120px 默认折叠 Inline 提示栏）
  - `<CenterTabs activeTab="markdown" | "diff" | "files" | "chat" />`（中工作区 Tab）

- [ ] **Step 1: 创建 `resource-tree.tsx`**

源 HTML：[`docs/design/pages/03-requirement-workspace.html`](../../../docs/design/pages/03-requirement-workspace.html#L132-L215)

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props { requirementId: string; }

const TREE_SECTIONS = [
  {
    label: '概览',
    nodes: [{ icon: '📋', label: '需求文档', href: '' }, { icon: '📊', label: '进度概览', href: '?progress' }],
  },
  {
    label: '设计',
    nodes: [
      { icon: '🗄️', label: '01-database', status: 'success' },
      { icon: '🔌', label: '02-api', status: 'success' },
      { icon: '⚙️', label: '03-service', status: 'planning' },
    ],
  },
  {
    label: '计划',
    nodes: [{ icon: '📝', label: 'tasks.md' }],
  },
  {
    label: '产物',
    nodes: [
      { icon: '📄', label: 'refund.sql', status: 'success' },
      { icon: '📄', label: 'refund-api.yaml', status: 'success' },
      { icon: '📄', label: 'apollo.yaml', status: 'warning' },
    ],
  },
  {
    label: '对话',
    nodes: [
      { icon: '💬', label: '001-analyze', status: 'success' },
      { icon: '💬', label: '002-design', status: 'success' },
      { icon: '💬', label: '003-code', status: 'active' },
    ],
  },
  {
    label: '仓库',
    nodes: [{ icon: '📦', label: 'refund-service' }, { icon: '📦', label: 'order-service' }],
  },
];

const STATUS_COLOR: Record<string, string> = {
  success: 'var(--success)', warning: 'var(--warning)', planning: '#a5b4fc', active: 'var(--brand)',
};

export function ResourceTree({ requirementId }: Props) {
  return (
    <aside className="bg-bg-elevated border-r border-border py-3 overflow-auto">
      {TREE_SECTIONS.map(section => (
        <div key={section.label} className="px-3 mb-4">
          <div className="flex items-center justify-between px-2 py-2 text-xs uppercase tracking-wider text-text-3 font-medium">
            <span>{section.label}</span>
            <span className="cursor-pointer">+</span>
          </div>
          {section.nodes.map(node => (
            <div key={node.label} className="flex items-center gap-2 h-7 px-2 rounded-md text-sm text-text-2 hover:bg-bg-subtle hover:text-text-1 cursor-pointer">
              <span className="text-sm w-4 text-center text-text-3">{node.icon}</span>
              <span>{node.label}</span>
              {node.status && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[node.status] }} />
              )}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: 创建 `inline-rail.tsx`**

源 HTML：[`docs/design/pages/03-requirement-workspace.html`](../../../docs/design/pages/03-requirement-workspace.html#L291-L319)

```tsx
'use client';
import { useState } from 'react';

interface Props { requirementId: string; }

interface RailCard {
  type: 'tip' | 'warn' | 'err' | 'plain';
  title: string;
  body: React.ReactNode;
  action?: string;
}

const CARDS_BY_REQ: Record<string, RailCard[]> = {
  'req-001': [
    { type: 'tip', title: '✨ 缺索引建议', body: <>检测到 <code className="font-mono">WHERE user_id + status</code> 查询无合适索引，建议在 <code className="font-mono">refund_order</code> 表加 <code className="font-mono">idx_user_status_created</code></>, action: '应用建议 →' },
    { type: 'warn', title: '⚠ 待回答', body: '退款失败时是否要回滚已扣减的优惠券额度？', action: '⌘K 去回答 →' },
    { type: 'plain', title: '📊 进度', body: '设计阶段 100% · 计划阶段 100% · 实施阶段 62% (12/19 tasks)' },
    { type: 'err', title: '🚨 Skill 阻塞', body: 'code-stage 等待 3 个澄清问题的回复' },
  ],
};

const BORDER_COLOR: Record<RailCard['type'], string> = {
  tip: 'var(--brand)', warn: 'var(--warning)', err: 'var(--error)', plain: 'var(--border)',
};

export function InlineRail({ requirementId }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const cards = CARDS_BY_REQ[requirementId] ?? [];

  if (collapsed) {
    return (
      <aside className="bg-bg-subtle border-l border-border p-3 w-12 flex flex-col items-center">
        <button onClick={() => setCollapsed(false)} className="text-text-3 hover:text-text-1 text-xs">⟩</button>
      </aside>
    );
  }

  return (
    <aside className="bg-bg-subtle border-l border-border p-3 overflow-auto w-60">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-text-3 font-medium">AI 提示</span>
        <button onClick={() => setCollapsed(true)} className="text-text-3 text-xs hover:text-text-1">⟨ 折叠</button>
      </div>
      {cards.map((c, i) => (
        <div key={i} className="bg-bg-elevated rounded-md p-3 mb-2 text-sm relative" style={{ borderLeft: `3px solid ${BORDER_COLOR[c.type]}` }}>
          <div className="font-medium mb-1">{c.title}</div>
          <div className="text-text-2 leading-relaxed">{c.body}</div>
          {c.action && <button className="mt-2 text-xs text-brand-600 hover:underline">{c.action}</button>}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 3: 创建 `center-tabs.tsx` 骨架**

源 HTML：[`docs/design/pages/03-requirement-workspace.html`](../../../docs/design/pages/03-requirement-workspace.html#L218-L226)

```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';

type Tab = 'markdown' | 'diff' | 'files' | 'chat';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'markdown', label: 'Markdown', icon: '📄' },
  { key: 'diff',     label: 'Diff',     icon: '🔀' },
  { key: 'files',    label: '文件树',   icon: '📁' },
  { key: 'chat',     label: '本次对话', icon: '💬' },
];

interface Props { defaultTab?: Tab; }

export function CenterTabs({ defaultTab = 'markdown' }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const active = (params.get('tab') as Tab | null) ?? defaultTab;
  return (
    <div className="flex items-center h-10 px-4 gap-0.5 border-b border-border bg-bg-subtle">
      {TABS.map(t => (
        <button key={t.key} onClick={() => router.replace(`?tab=${t.key}`)}
          className={`flex items-center gap-1.5 h-7 px-3 text-sm rounded-md ${active === t.key ? 'bg-bg-elevated text-text-1 font-medium shadow-sm' : 'text-text-2 hover:bg-bg-elevated'}`}>
          <span>{t.icon}</span> {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 创建 `(workspace)/requirements/[id]/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import { ResourceTree } from '@/components/resource-tree';
import { InlineRail } from '@/components/inline-rail';

export default function RequirementLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  return (
    <div className="grid grid-cols-[240px_1fr_120px] min-h-[calc(100vh-72px)] bg-bg">
      <ResourceTree requirementId={params.id} />
      {children}
      <InlineRail requirementId={params.id} />
    </div>
  );
}
```

- [ ] **Step 5: 创建占位 `(workspace)/requirements/[id]/page.tsx` (Task 7 替换)**

```tsx
import { CenterTabs } from '@/components/center-tabs';

interface Props { params: { id: string }; }

export default function RequirementPage({ params }: Props) {
  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <CenterTabs defaultTab="markdown" />
      <div className="flex-1 grid place-items-center text-text-3 text-sm">
        Requirement <code className="font-mono text-text-1 ml-1">{params.id}</code> · 待 Task 7 翻译 docs/design/pages/03-requirement-workspace.html
      </div>
    </section>
  );
}
```

- [ ] **Step 6: 验证**

打开 `http://localhost:3333/requirements/req-001`：
- 顶部 StatusBar（继承 (workspace)）
- 左侧 Sidebar
- 左 240 资源树（6 section）
- 中间 CenterTabs（4 tabs）+ Task 7 占位文案
- 右 120 折叠条，点 `⟩` 展开 4 张 inline card
- 切换 ⌘K 不变化（仍未实装 overlay，但 console log 还在）

- [ ] **Step 7: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/app/\(workspace\)/requirements
git add apps/web/src/components/resource-tree.tsx apps/web/src/components/inline-rail.tsx apps/web/src/components/center-tabs.tsx
git commit -m "feat(web): 加 requirements/[id] 三栏壳与 ResourceTree + InlineRail + CenterTabs"
```

---

## Task 4: 抽共享组件库 — StatusBadge / AIStatusDot / ProgressBar / EmptyState / StatCard / RequestCard / ActiveSessionCard / InboxItem

> 8 个组件，每个都用 single responsibility + 抽离后可在 Task 5/6/7/8 各页面直接 import 使用。

**Files:**
- Create:
  - `apps/web/src/components/status-badge.tsx`（9 variant）
  - `apps/web/src/components/ai-status-dot.tsx`（6 variant）
  - `apps/web/src/components/progress-bar.tsx`
  - `apps/web/src/components/empty-state.tsx`
  - `apps/web/src/components/stat-card.tsx`
  - `apps/web/src/components/request-card.tsx`
  - `apps/web/src/components/active-session-card.tsx`
  - `apps/web/src/components/inbox-item.tsx`

**Interfaces (统一给下游 Task 5/6/7/8):**

```typescript
// status-badge.tsx
import type { RequirementStatus } from '@/app/(workspace)/data/mock';
export function StatusBadge({ status }: { status: RequirementStatus }): JSX.Element;

// ai-status-dot.tsx
import type { AIStatus } from '@/app/(workspace)/data/mock';
export function AIStatusDot({ status, showLabel?: boolean }: { status: AIStatus; showLabel?: boolean }): JSX.Element;

// progress-bar.tsx
export function ProgressBar({ percent, color }: { percent: number; color?: 'brand' | 'warning' | 'planning' }): JSX.Element;

// empty-state.tsx
export function EmptyState({ icon, title, subtitle, cta }: { icon: string; title: string; subtitle?: string; cta?: { label: string; href?: string; onClick?: () => void } }): JSX.Element;

// stat-card.tsx
export function StatCard({ label, value, delta, deltaTone }: { label: string; value: number | string; delta?: string; deltaTone?: 'up' | 'down' | 'neutral' }): JSX.Element;

// request-card.tsx
export function RequestCard({ requirement }: { requirement: Requirement }): JSX.Element;

// active-session-card.tsx
export function ActiveSessionCard({ session }: { session: Session }): JSX.Element;

// inbox-item.tsx
export function InboxItem({ item }: { item: InboxItem }): JSX.Element;
```

- [ ] **Step 1: 写 `status-badge.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L107-L116)

```tsx
import { clsx } from 'clsx';
import type { RequirementStatus } from '@/app/(workspace)/data/mock';

const VARIANTS: Record<RequirementStatus, { dot: string; bg: string; label: string }> = {
  draft:        { dot: 'bg-[#cbd5e1]', bg: 'bg-bg-subtle',          label: '草稿' },
  analyzing:    { dot: 'bg-[#a5b4fc]', bg: 'bg-bg-subtle',          label: '分析中' },
  designing:    { dot: 'bg-[#a5b4fc]', bg: 'bg-bg-subtle',          label: '设计中' },
  planning:     { dot: 'bg-[#a5b4fc]', bg: 'bg-bg-subtle',          label: '计划中' },
  implementing: { dot: 'bg-brand',     bg: 'bg-bg-subtle',          label: '实施中' },
  submitting:   { dot: 'bg-warning',   bg: 'bg-bg-subtle',          label: '提交中' },
  done:         { dot: 'bg-success',   bg: 'bg-bg-subtle',          label: '已完成' },
  archived:     { dot: 'bg-[#64748b]', bg: 'bg-bg-subtle',          label: '已归档' },
  // CLARIFYING 特殊：品牌色点 + 警告红角标
  clarifying:   { dot: 'bg-brand',     bg: 'bg-bg-subtle',          label: '待澄清' },
};

export function StatusBadge({ status }: { status: RequirementStatus }) {
  const v = VARIANTS[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 h-5 px-2 rounded text-xs font-medium', v.bg, 'text-text-2')}>
      <span className={clsx('w-1.5 h-1.5 rounded-full relative', v.dot)}>
        {status === 'clarifying' && (
          <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-error border-[1.5px] border-bg-elevated" />
        )}
      </span>
      {v.label}
    </span>
  );
}
```

- [ ] **Step 2: 写 `ai-status-dot.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L92-L103)

```tsx
import { clsx } from 'clsx';
import type { AIStatus } from '@/app/(workspace)/data/mock';

const LABEL: Record<AIStatus, string> = {
  idle: '空闲', thinking: '思考中', tool_calling: '工具调用中',
  writing: '正在写入', awaiting_user: '等待回答', error: '错误',
};

const DOT_CLASS: Record<AIStatus, string> = {
  idle:           'bg-text-3',
  thinking:       'bg-brand animate-bounce',
  tool_calling:   'bg-brand animate-spin rounded-none',
  writing:        'bg-success',
  awaiting_user:  'bg-warning animate-pulse',
  error:          'bg-error animate-pulse',
};

export function AIStatusDot({ status, showLabel }: { status: AIStatus; showLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={clsx('w-2 h-2 rounded-full', DOT_CLASS[status])} />
      {showLabel && <span>{LABEL[status]}</span>}
    </span>
  );
}
```

- [ ] **Step 3: 写 `progress-bar.tsx`**

```tsx
interface Props { percent: number; color?: 'brand' | 'warning' | 'planning'; }
const COLOR_CLASS: Record<NonNullable<Props['color']>, string> = {
  brand: 'bg-brand', warning: 'bg-warning', planning: 'bg-[#a5b4fc]',
};

export function ProgressBar({ percent, color = 'brand' }: Props) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1 bg-bg-subtle rounded-sm overflow-hidden">
        <div className={`h-full ${COLOR_CLASS[color]} rounded-sm`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <span className="text-xs text-text-3 font-variant-numeric tabular-nums">{percent}%</span>
    </div>
  );
}
```

- [ ] **Step 4: 写 `empty-state.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L145-L149)

```tsx
interface Cta { label: string; href?: string; onClick?: () => void; }
interface Props { icon: string; title: string; subtitle?: string; cta?: Cta; }

export function EmptyState({ icon, title, subtitle, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center text-text-3 border border-dashed border-border-strong rounded-lg">
      <div className="text-5xl mb-3 opacity-50">{icon}</div>
      <div className="text-text-2 mb-1">{title}</div>
      {subtitle && <div className="text-sm mb-4">{subtitle}</div>}
      {cta && (
        <a href={cta.href} onClick={cta.onClick}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md font-medium text-sm bg-brand text-white hover:bg-brand-600">
          {cta.label}
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 写 `stat-card.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L68-L75)

```tsx
interface Props {
  label: string;
  value: number | string;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'neutral';
}

const DELTA_COLOR = { up: 'text-success', down: 'text-error', neutral: 'text-text-3' };

export function StatCard({ label, value, delta, deltaTone = 'neutral' }: Props) {
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-5">
      <div className="text-text-3 text-sm mb-2">{label}</div>
      <div className="text-[32px] font-semibold tracking-tight leading-none">{value}</div>
      {delta && <div className={`text-xs mt-2 ${DELTA_COLOR[deltaTone]}`}>{delta}</div>}
    </div>
  );
}
```

- [ ] **Step 6: 写 `request-card.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L128-L140)

```tsx
import Link from 'next/link';
import type { Requirement } from '@/app/(workspace)/data/mock';
import { StatusBadge } from './status-badge';
import { ProgressBar } from './progress-bar';

const PROGRESS_COLOR = (status: Requirement['status']): 'brand' | 'warning' | 'planning' => {
  if (status === 'clarifying') return 'warning';
  if (status === 'designing' || status === 'planning') return 'planning';
  return 'brand';
};

export function RequestCard({ requirement: r }: { requirement: Requirement }) {
  return (
    <Link href={`/requirements/${r.id}`}
      className="block bg-bg-elevated border border-border rounded-lg p-4 hover:-translate-y-px hover:shadow-md hover:border-border-strong transition">
      <div className="flex items-center justify-between mb-3">
        <StatusBadge status={r.status} />
        <span className="text-text-3 text-xs">{new Date(r.updatedAt).toLocaleString('zh-CN', { hour: 'numeric', minute: 'numeric', hour12: false }) + ' 前'}</span>
      </div>
      <div className="text-md font-medium mb-2">{r.title}</div>
      <div className="flex gap-1 flex-wrap mb-3">
        {r.repos.map(repo => (
          <span key={repo} className="h-[18px] px-1.5 bg-bg-subtle rounded-sm font-mono text-xs text-text-2 flex items-center">{repo}</span>
        ))}
      </div>
      <ProgressBar percent={r.progress} color={PROGRESS_COLOR(r.status)} />
    </Link>
  );
}
```

- [ ] **Step 7: 写 `active-session-card.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L77-L90)

```tsx
import type { Session } from '@/app/(workspace)/data/mock';
import { AIStatusDot } from './ai-status-dot';

const ICON_BG: Record<string, string> = { default: 'bg-brand-50 text-brand-700', warn: 'bg-[#fde68a] text-[#78350f]' };
const SESSION_ICON: Record<string, { text: string; bgKey: 'default' | 'warn' }> = {
  'req-001': { text: '退', bgKey: 'default' },
  'req-002': { text: '会', bgKey: 'warn' },
};

export function ActiveSessionCard({ session }: { session: Session }) {
  const icon = SESSION_ICON[session.requirementId] ?? { text: '·', bgKey: 'default' as const };
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4 grid grid-cols-[1fr_auto] items-center gap-4">
      <div className="flex items-center gap-4">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center font-semibold text-md ${ICON_BG[icon.bgKey]}`}>{icon.text}</div>
        <div>
          <div className="text-md font-medium mb-0.5">{session.title}</div>
          <div className="flex items-center gap-3 text-sm text-text-2">
            <AIStatusDot status={session.aiStatus} showLabel />
            <span className="w-1.25 h-1.25 rounded-full bg-text-3" />
            <span>{session.currentTask}</span>
            {session.filesRead != null && <>
              <span className="w-1.25 h-1.25 rounded-full bg-text-3" />
              <span>已读取 {session.filesRead} 个文件</span>
            </>}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">查看对话</button>
        <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">打开 IDEA</button>
        <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">查看 Diff</button>
        <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">▶ 继续</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 写 `inbox-item.tsx`**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L117-L126)

```tsx
import type { InboxItem as InboxItemT } from '@/app/(workspace)/data/mock';

const KIND_ICON: Record<InboxItemT['kind'], { char: string; bg: string }> = {
  question: { char: '?', bg: 'bg-warning' },
  error:    { char: '!', bg: 'bg-error' },
  todo:     { char: '☐', bg: 'bg-info' },
};

export function InboxItem({ item }: { item: InboxItemT }) {
  const ic = KIND_ICON[item.kind];
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4 grid grid-cols-[24px_1fr_auto] gap-4 items-start">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[13px] ${ic.bg}`}>{ic.char}</div>
      <div>
        <div className="text-sm text-text-3 mb-1">{item.requirementTitle} · {item.kind === 'error' ? '错误' : 'AI 提问'}</div>
        <div className="text-md leading-snug">{item.message}</div>
      </div>
      <div className="text-xs text-text-3">{item.agoMinutes < 60 ? `${item.agoMinutes} 分钟前` : `${Math.floor(item.agoMinutes / 60)} 小时前`}</div>
    </div>
  );
}
```

- [ ] **Step 9: 验证**

```bash
corepack pnpm --filter @ai-devspace/web dev &
```

打开 `http://localhost:3333/requirements/req-001` — 应仍为 Task 3 占位文案（无变化）。
打开 `http://localhost:3333/dev/tokens` — 不变。

每个组件单独通过 DevTools React DevTools 验证不存在运行时错误（打开任何产品页 console 无 error）。

- [ ] **Step 10: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/components/{status-badge,ai-status-dot,progress-bar,empty-state,stat-card,request-card,active-session-card,inbox-item}.tsx
git commit -m "feat(web): 抽 StatusBadge / AIStatusDot / ProgressBar / EmptyState / StatCard / RequestCard / ActiveSessionCard / InboxItem 共享组件"
```

---

## Task 5: 翻 docs/design/pages/01-dashboard.html → (workspace)/page.tsx（主页）

**Files:**
- Modify: `apps/web/src/app/(workspace)/page.tsx`（替换 Task 2 的占位）

**Interfaces:**
- 复用: `Task 4` 抽出的所有组件

- [ ] **Step 1: 完整翻译 01 Dashboard**

源 HTML：[`docs/design/pages/01-dashboard.html`](../../../docs/design/pages/01-dashboard.html#L193-L349)

```tsx
import { requirements, sessions, inbox } from '@/app/(workspace)/data/mock';
import { StatCard } from '@/components/stat-card';
import { RequestCard } from '@/components/request-card';
import { ActiveSessionCard } from '@/components/active-session-card';
import { InboxItem as InboxItemComp } from '@/components/inbox-item';

export default function DashboardPage() {
  const ongoing = requirements.filter(r => r.status !== 'done' && r.status !== 'archived');
  return (
    <main className="p-6 lg:p-8 overflow-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">概览</h1>
          <div className="text-text-2 text-md mt-1">下午好，<strong className="text-text-1 font-medium">李雷</strong> · 当前 {ongoing.length} 个进行中需求，{sessions.length} 个 AI 会话活跃</div>
        </div>
        <div className="flex gap-2">
          <button className="h-8 px-3 rounded-md text-md font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle">查看历史</button>
          <button className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600">+ 新建需求</button>
        </div>
      </div>

      {/* 4 个 Stat */}
      <section className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="进行中" value={ongoing.length} delta="+2 本周" deltaTone="up" />
        <StatCard label="已完成" value={23} delta="本月" />
        <StatCard label="待回答" value={3} delta="AI 提问" deltaTone="neutral" warningOverride />
        <StatCard label="知识沉淀" value={47} delta="+5 自动" deltaTone="up" />
      </section>

      {/* 进行中需求 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">进行中的需求</h2>
          <span className="text-text-3 text-sm">{ongoing.length} 个 · {sessions.length} 个 AI 活跃</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {ongoing.map(r => <RequestCard key={r.id} requirement={r} />)}
        </div>
      </section>

      {/* 当前活跃会话 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">当前活跃会话</h2>
          <span className="text-text-3 text-sm">来自 {new Set(sessions.map(s => s.requirementId)).size} 个需求的 AI 子进程</span>
        </div>
        <div className="flex flex-col gap-2">
          {sessions.map(s => <ActiveSessionCard key={s.id} session={s} />)}
        </div>
      </section>

      {/* 待办 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">待办</h2>
          <span className="text-text-3 text-sm">{inbox.length} 项 · 按时间倒序</span>
        </div>
        <div className="flex flex-col gap-2">
          {inbox.map(i => <InboxItemComp key={i.id} item={i} />)}
        </div>
      </section>

      <div className="mt-4 p-4 bg-[#fffbeb] border border-[#fde68a] rounded-md text-sm text-[#78350f]">
        <strong className="text-[#451a03]">设计说明：</strong>Dashboard 是首屏，遵循 Linear「3 段信息密度」—— 统计 → 进行中需求 → 活跃会话 → 待办。所有数字都是 mock 数据（[P1+ 接 SSE](file:///d:/TraeProject/AI-DevSpace/.scratch/ai-devspace-mvp/issues/03-agent-skeleton.md)）。
      </div>
    </main>
  );
}
```

> 注：上面 `<StatCard ... warningOverride />` 是非标准 prop；实施时要么去掉并改 `deltaTone="warning"`、要么用 `<StatCard ... />` 然后包一个 className 覆盖 value 文本色（warning 变黄），由实施 agent 据 [01-dashboard.html#L221](docs/design/pages/01-dashboard.html#L221)（"3" 数字 color=warning）自行实现。

- [ ] **Step 2: 验证**

打开 `http://localhost:3333`：
- 4 个 Stat 卡（"待回答"卡 value 是黄色字体）
- 进行中需求 3 张卡（退款功能 62% / 会员等级 25% / 支付链路 38%）
- 活跃会话 2 张卡
- 待办 3 项
- 视觉上与 [01-dashboard.html](docs/design/pages/01-dashboard.html) 像素级一致

- [ ] **Step 3: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/app/\(workspace\)/page.tsx
git commit -m "feat(web): 翻译 docs/design/pages/01-dashboard.html 至 (workspace)/page.tsx"
```

---

## Task 6: 翻 docs/design/pages/02-requirements.html → (workspace)/requirements/page.tsx

**Files:**
- Create: `apps/web/src/app/(workspace)/requirements/page.tsx`（列表页）
- Modify: `apps/web/src/app/(workspace)/data/mock.ts`（补 `requirements` 列表用全部 mock 数据；当前 3 条不够密集）

**Interfaces:** 复用 `StatusBadge / EmptyState`

- [ ] **Step 1: 扩 mock 数据**

在 `mock.ts` `requirements` 数组再追加约 8 条，覆盖所有 9 个 status variant + 多个 progress / repos / 多个 updatedAt 分布。

- [ ] **Step 2: 写列表页**

源 HTML：[`docs/design/pages/02-requirements.html`](../../../docs/design/pages/02-requirements.html)（不展开引用；实现 agent 必读源 HTML 作为基线）

```tsx
import Link from 'next/link';
import type { Requirement, RequirementStatus } from '@/app/(workspace)/data/mock';
import { requirements } from '@/app/(workspace)/data/mock';
import { StatusBadge } from '@/components/status-badge';

const STATUS_FILTERS: RequirementStatus[] = [
  'draft', 'analyzing', 'designing', 'planning', 'implementing', 'submitting', 'done', 'archived', 'clarifying',
];

function ago(iso: string) {
  const m = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} 分钟前`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / 60 / 24)} 天前`;
}

export default function RequirementsPage() {
  return (
    <main className="p-6 lg:p-8 overflow-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">需求</h1>
          <div className="text-text-2 text-md mt-1">{requirements.length} 个需求 · 按更新时间倒序</div>
        </div>
        <div className="flex gap-2">
          <input className="h-8 px-3 rounded-md border border-border bg-bg-elevated text-sm" placeholder="搜索…" />
          <button className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600">+ 新建需求</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 text-sm">
        {STATUS_FILTERS.map(s => (
          <button key={s} className="h-7 px-3 rounded-md bg-bg-elevated border border-border text-text-2 hover:bg-bg-subtle hover:text-text-1">
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden">
        {requirements.map(r => (
          <Link key={r.id} href={`/requirements/${r.id}`}
            className="grid grid-cols-[120px_1fr_120px_80px] items-center gap-4 h-12 px-4 hover:bg-bg-subtle text-sm">
            <StatusBadge status={r.status} />
            <div className="text-text-1 font-medium">{r.title}</div>
            <div className="flex gap-1 flex-wrap">
              {r.repos.map(p => <span key={p} className="h-[18px] px-1.5 bg-bg-subtle rounded-sm font-mono text-[11px] text-text-2 flex items-center">{p}</span>)}
            </div>
            <div className="text-xs text-text-3 text-right">{ago(r.updatedAt)}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 验证**

打开 `http://localhost:3333/requirements`：列表样式（每行 48px）+ 状态徽章 + repo 标签 + ago 时间，与 [02-requirements.html](docs/design/pages/02-requirements.html) 一致。

- [ ] **Step 4: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/app/\(workspace\)/requirements/page.tsx apps/web/src/app/\(workspace\)/data/mock.ts
git commit -m "feat(web): 翻译 docs/design/pages/02-requirements.html 至 requirements 列表页"
```

---

## Task 7: 翻 03 + 04 + 05 + 06 + 07 → requirements/[id]/ 五页

> 5 页共用 Task 3 的三栏壳（ResourceTree / InlineRail / CenterTabs）。每页 body 不同，依据 docs/design/pages/03..07-*.html。

**Files:**
- Modify: `apps/web/src/app/(workspace)/requirements/[id]/page.tsx` (03 — workspace 主页面，三栏壳 + Markdown 视图)
- Create: `apps/web/src/app/(workspace)/requirements/[id]/repos/page.tsx` (04)
- Create: `apps/web/src/app/(workspace)/requirements/[id]/artifacts/page.tsx` (05)
- Create: `apps/web/src/app/(workspace)/requirements/[id]/history/page.tsx` (06)
- Create: `apps/web/src/app/(workspace)/requirements/[id]/settings/page.tsx` (07)
- Modify: `apps/web/src/app/(workspace)/data/mock.ts`（补 artifacts / history / settings 的 mock 数据）

**Interfaces:** 复用 `CenterTabs / ResourceTree / InlineRail` 与 Task 4 全部组件

- [ ] **Step 1: 补 mock 数据**

在 `mock.ts` 加 `artifactsFor(reqId)`、`historyFor(reqId)`、`settingsFor(reqId)`（每函数返回该 req 的对应 mock 数组，Task 2 已添加 artifacts 全局数组可复用）。

- [ ] **Step 2: 实现 03 page.tsx（详情 + Markdown 视图）**

源 HTML：[`docs/design/pages/03-requirement-workspace.html`](../../../docs/design/pages/03-requirement-workspace.html)

```tsx
import { CenterTabs } from '@/components/center-tabs';
import { requirements, artifacts } from '@/app/(workspace)/data/mock';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';

interface Props { params: { id: string }; }

export default function RequirementPage({ params }: Props) {
  const req = requirements.find(r => r.id === params.id) ?? requirements[0];

  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <CenterTabs defaultTab="markdown" />

      <div className="flex items-center justify-between h-10 px-6 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-3">退款功能优化</span>
          <span className="text-text-3">/</span>
          <span className="text-text-3">设计</span>
          <span className="text-text-3">/</span>
          <span className="text-text-1">01-database.md</span>
        </div>
        <div className="flex gap-2">
          <button className="h-7 px-2 text-text-2 text-sm hover:text-text-1">↻ 重新生成</button>
          <button className="h-7 px-3 bg-bg-subtle border border-border-strong rounded-md text-sm text-text-1 hover:bg-bg-elevated">⌘⇧E 打开 IDEA</button>
          <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">▶ 运行 code-stage</button>
        </div>
      </div>

      <article className="p-8 px-12 max-w-[880px] mx-auto overflow-auto h-[calc(100vh-152px)]">
        <h1 className="text-2xl font-semibold tracking-tight mb-2 flex items-center gap-3">
          01-database <span className="inline-flex items-center gap-1 px-1.5 bg-[#fff7ed] border border-dashed border-warning rounded text-sm text-[#92400e]">✨</span>
        </h1>
        <div className="text-text-3 text-sm mb-6 flex gap-3 items-center">
          <span>由 <strong className="text-text-2 font-medium">design-stage</strong> 生成 · 2026-07-08</span>
          <span>·</span>
          <span>14 次修订</span>
          <span>·</span>
          <span className="text-success">✓ 已采纳</span>
        </div>

        <h2 className="text-lg font-semibold mt-6 mb-3 pb-2 border-b border-border">1. 退款表 <code className="font-mono text-brand-600">refund_order</code></h2>
        <p className="text-md leading-relaxed text-text-1 mb-3">主表，记录每笔退款订单的状态、金额、退款渠道等信息。</p>

        <table className="w-full text-sm my-3 border-collapse">
          <thead>
            <tr><th className="text-left py-2 px-3 bg-bg-subtle font-medium text-text-2 border-b border-border">字段</th><th className="text-left py-2 px-3 bg-bg-subtle font-medium text-text-2 border-b border-border">类型</th><th className="text-left py-2 px-3 bg-bg-subtle font-medium text-text-2 border-b border-border">说明</th></tr>
          </thead>
          <tbody>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">id</code></td><td className="py-2 px-3 border-b border-border">BIGINT PK</td><td className="py-2 px-3 border-b border-border">主键，雪花算法</td></tr>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">order_id</code></td><td className="py-2 px-3 border-b border-border">BIGINT</td><td className="py-2 px-3 border-b border-border">原订单 ID</td></tr>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">amount</code></td><td className="py-2 px-3 border-b border-border">DECIMAL(10,2)</td><td className="py-2 px-3 border-b border-border">退款金额（元）</td></tr>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">status</code></td><td className="py-2 px-3 border-b border-border">TINYINT</td><td className="py-2 px-3 border-b border-border">1-待审核 2-退款中 3-成功 4-失败</td></tr>
          </tbody>
        </table>

        <blockquote className="border-l-[3px] border-brand bg-brand-50 px-4 py-3 rounded-r-md my-3 text-text-2">
          <strong className="text-text-1">💡 AI 建议：</strong>高频查询场景 <code className="font-mono text-brand-600">WHERE user_id=? AND status=? ORDER BY created_at DESC</code>，建议加联合索引 <code className="font-mono text-brand-600">idx_user_status_created (user_id, status, created_at)</code>。
        </blockquote>

        <h2 className="text-lg font-semibold mt-6 mb-3 pb-2 border-b border-border">2. 退款流水表 <code className="font-mono text-brand-600">refund_flow</code></h2>
        <p className="text-md leading-relaxed text-text-1 mb-3">记录退款链路上的每一步状态变更（异步、回调、重试）。</p>

        <h2 className="text-lg font-semibold mt-6 mb-3 pb-2 border-b border-border">3. 索引设计</h2>
        <ul className="list-disc pl-6 text-md leading-relaxed text-text-1 mb-3">
          <li><code className="font-mono text-brand-600">idx_user_status_created (user_id, status, created_at)</code> — 用户维度查询</li>
          <li><code className="font-mono text-brand-600">idx_order (order_id)</code> — 原订单维度</li>
          <li><code className="font-mono text-brand-600">idx_status_updated (status, updated_at)</code> — 后台扫描任务</li>
        </ul>

        <div className="my-4 mx-8 mb-3 p-3 px-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明：</strong>Markdown 视图（Task 7 基础版）；diff / 文件树 / 对话切 tab 见 [CenterTabs](#)；Markdown 实时语法高亮接 react-markdown 在 P1+。
        </div>
      </article>
    </section>
  );
}
```

- [ ] **Step 3: 实现 04 repos/page.tsx**

源 HTML：[`docs/design/pages/04-requirement-repos.html`](../../../docs/design/pages/04-requirement-repos.html)

实现要点：复用三栏壳；中工作区替换为一个仓库列表（卡片网格），每张卡片显示仓库名 + 分支 + 最新 commit + changed files 计数 + `[打开 IDEA]` / `[View Diff]` 按钮。

复用 `repositories` mock 数据，按 `repositories.filter(r => /* 与当前 req 相关 */)` 过滤。

- [ ] **Step 4: 实现 05 artifacts/page.tsx**

源 HTML：[`docs/design/pages/05-requirement-artifacts.html`](../../../docs/design/pages/05-requirement-artifacts.html)

实现要点：复用三栏壳；中工作区按 artifact.type 分组（Database / Config / API / Test / Doc / Other），每组下面渲染 ArtifactCard（类似设计稿的列表 + 状态点）。

- [ ] **Step 5: 实现 06 history/page.tsx**

源 HTML：[`docs/design/pages/06-requirement-history.html`](../../../docs/design/pages/06-requirement-history.html)

实现要点：复用三栏壳；中工作区为对话历史时间轴，按 `historyFor(reqId)` 渲染 — 时间 + 角色 + 消息体。

- [ ] **Step 6: 实现 07 settings/page.tsx**

源 HTML：[`docs/design/pages/07-requirement-settings.html`](../../../docs/design/pages/07-requirement-settings.html)

实现要点：复用三栏壳；中工作区为 Form（meta.yaml 字段：title / status / repos / assigned_to 等），与 settingsFor(reqId) 双向绑定（Step 2 仅展示，编辑 P1+ 接 Agent）。

- [ ] **Step 7: 验证**

- 打开 `http://localhost:3333/requirements/req-001` → 03 page 渲染（Markdown 视图）
- 打开 `http://localhost:3333/requirements/req-001/repos` → 04 page 渲染（仓库列表）
- 打开 `http://localhost:3333/requirements/req-001/artifacts` → 05 page 渲染（产物分组）
- 打开 `http://localhost:3333/requirements/req-001/history` → 06 page 渲染（对话时间轴）
- 打开 `http://localhost:3333/requirements/req-001/settings` → 07 page 渲染（meta.yaml 表单）
- 三栏壳（左 240 资源树 + 右 120 折叠 InlineRail + 中工作区）5 页一致
- 切换 CenterTabs Tab（在 03 页内）刷新页面保持选中（用 `?tab=` query string）

- [ ] **Step 8: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/app/\(workspace\)/requirements
git commit -m "feat(web): 翻译 03-07 五页需求详情至 requirements/[id]/{page,repos,artifacts,history,settings}"
```

---

## Task 8: 翻 08 / 09 / 10 / 11 / 12 → repos + knowledge + skills + settings 五页

> 5 页共用 Task 2 的 StatusBar + Sidebar + Sidebar 导航。每个页面都有自己的体；不复用 ResourceTree / InlineRail。

**Files:**
- Create: `apps/web/src/app/(workspace)/repos/page.tsx` (08)
- Create: `apps/web/src/app/(workspace)/repos/[name]/page.tsx` (09)
- Create: `apps/web/src/app/(workspace)/knowledge/page.tsx` (10)
- Create: `apps/web/src/app/(workspace)/skills/page.tsx` (11)
- Create: `apps/web/src/app/(workspace)/settings/page.tsx` (12)
- Modify: `apps/web/src/app/(workspace)/data/mock.ts`（补 `repositories` 全集 + `knowledge` + `skills` + `settings` mock）

- [ ] **Step 1: 补 mock 数据**

`repositories` 数组已有 3 条；`knowledge` 加 10+ 条（domain / patterns / bugs 三类）；`skills` 加 6 个内置 + 2 个用户；`settings` 加 1 份全局设置对象（`{ theme, typewriterSpeed, silentMode }`）。

- [ ] **Step 2: 08 repos/page.tsx**

源 HTML：[`docs/design/pages/08-repos.html`](../../../docs/design/pages/08-repos.html)

实现要点：仓库池卡片网格（每卡片：仓库名 + 分支 badge + 最 commit hash + Changed Files 计数 + 跳转到 09 的链接）。

- [ ] **Step 3: 09 repos/[name]/page.tsx**

源 HTML：[`docs/design/pages/09-repo-detail.html`](../../../docs/design/pages/09-repo-detail.html)

实现要点：仓库详情页 — 仓库头部信息（`Open in IDEA` / `View Diff` 按钮）+ worktree 列表（每个 worktree = req name + branch + last commit time）。

- [ ] **Step 4: 10 knowledge/page.tsx**

源 HTML：[`docs/design/pages/10-knowledge.html`](../../../docs/design/pages/10-knowledge.html)

实现要点：分类树（Domain / Patterns / Bugs）+ 右侧条目列表 + 搜索框。

- [ ] **Step 5: 11 skills/page.tsx**

源 HTML：[`docs/design/pages/11-skills.html`](../../../docs/design/pages/11-skills.html)

实现要点：Skill 列表（每个 Skill 一行：名 + 阶段 + 描述 + 是否内置 badge）；tabs："内置" / "我的"。

- [ ] **Step 6: 12 settings/page.tsx**

源 HTML：[`docs/design/pages/12-settings.html`](../../../docs/design/pages/12-settings.html)

实现要点：设置面板 — Theme（默认三档 = 系统/亮/暗，与 next-themes 对接）+ 打字机速度选择（10/20/30/关）+ 静默模式开关。**注意**：已经存在 `apps/web/src/components/theme-switcher.tsx`，本 task 复用。

- [ ] **Step 7: 验证**

打开 `http://localhost:3333/repos` / `/repos/refund-service` / `/knowledge` / `/skills` / `/settings` 各自渲染，与对应 HTML 视觉稿一致。Sidebar 当前 path 高亮仍生效。

- [ ] **Step 8: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/app/\(workspace\)/{repos,knowledge,skills,settings}
git commit -m "feat(web): 翻译 08-12 路由 (repos / knowledge / skills / settings)"
```

---

## Task 9: 翻 3 层叠 overlay — CommandPalette + ShortcutsCheatsheet + NewRequirementModal

**Files:**
- Modify: `apps/web/src/components/keyboard-bridge.tsx`（实际接通三个 overlay state）
- Create: `apps/web/src/components/command-palette.tsx`
- Create: `apps/web/src/components/shortcuts-cheatsheet.tsx`
- Create: `apps/web/src/components/new-requirement-modal.tsx`
- Create: `apps/web/src/components/ui-overlay-store.tsx`（client context，键盘监听 → 弹窗 state）

**Interfaces:**

```typescript
// ui-overlay-store.tsx
'use client';
export function UIOverlayProvider({ children }: { children: ReactNode }): JSX.Element;
export function useUIOverlay(): { cmdK: boolean; cmdSlash: boolean; cmdN: boolean; close(): void; open(key: 'cmdK' | 'cmdSlash' | 'cmdN'): void };
```

- [ ] **Step 1: 创建 UIOverlayProvider**

```tsx
'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Key = 'cmdK' | 'cmdSlash' | 'cmdN';
interface State {
  cmdK: boolean; cmdSlash: boolean; cmdN: boolean;
  open(k: Key): void; close(): void;
}
const Ctx = createContext<State | null>(null);

export function UIOverlayProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Record<Key, boolean>>({ cmdK: false, cmdSlash: false, cmdN: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); setS(prev => ({ ...prev, cmdK: true })); }
      if (e.key === '/') { e.preventDefault(); setS(prev => ({ ...prev, cmdSlash: true })); }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setS(prev => ({ ...prev, cmdN: true })); }
      if (e.key === 'Escape') setS({ cmdK: false, cmdSlash: false, cmdN: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <Ctx.Provider value={{ ...s, open: k => setS(p => ({ ...p, [k]: true })), close: () => setS({ cmdK: false, cmdSlash: false, cmdN: false }) }}>{children}</Ctx.Provider>;
}

export function useUIOverlay() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUIOverlay must be used inside UIOverlayProvider');
  return v;
}
```

- [ ] **Step 2: 改写 `keyboard-bridge.tsx` 简化（仅 re-export UIOverlayProvider 以保持兼容）**

> 旧 `KeyboardBridge` 是 Task 2 占位；本 task 升级为 Provider。

- [ ] **Step 3: 在 `(workspace)/layout.tsx` 用 Provider 包 children**

```tsx
import { UIOverlayProvider } from '@/components/ui-overlay-store';
// ...
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <UIOverlayProvider>
      <div className="min-h-screen flex flex-col">
        <StatusBar ... />
        <div className="flex-1 grid grid-cols-[56px_1fr]">
          <Sidebar />
          <main className="overflow-auto">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <ShortcutsCheatsheet />
      <NewRequirementModal />
    </UIOverlayProvider>
  );
}
```

> 上面用了三个组件名，本 task 后续 step 写实现。

- [ ] **Step 4: 13 CommandPalette**

源 HTML：[`docs/design/pages/13-command-palette.html`](../../../docs/design/pages/13-command-palette.html)

```tsx
'use client';
import { useUIOverlay } from './ui-overlay-store';
import { useEffect, useState } from 'react';

export function CommandPalette() {
  const { cmdK, close } = useUIOverlay();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'command' | 'ai' | 'history'>('command');
  useEffect(() => { if (cmdK) setQuery(''); }, [cmdK]);
  if (!cmdK) return null;

  const items = query.startsWith('>') ? CMD_FILTERED(query.slice(1)) : query.startsWith('✨') ? AI_SUGGEST(query.slice(1)) : ALL;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm">
      <div className={`relative z-[101] w-[680px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden ${mode === 'ai' ? 'border-t-brand-500 border-t' : ''}`}>
        <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-b border-border text-xs text-text-3">
          <div className="inline-flex items-center gap-1.5">
            <span className="bg-bg-elevated border border-border px-1.5 py-0.5 rounded font-mono">退款功能优化</span>
            <span>· 绑当前需求（⌘⇧K 切全局）</span>
          </div>
          <div className="flex gap-1">
            {(['command', 'ai', 'history'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded text-xs ${mode === m ? 'bg-bg-elevated text-brand-600 font-medium shadow-sm' : 'text-text-2'}`}>
                {m === 'command' ? '命令' : m === 'ai' ? 'AI 提问' : '历史'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <span className={`text-lg ${mode === 'ai' ? 'text-brand-600' : 'text-text-3'}`}>⌘K</span>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索命令、AI 提问、文件…" className="flex-1 border-none outline-none bg-transparent text-lg text-text-1 placeholder-text-3" />
          <span className="font-mono text-xs text-text-3 bg-bg-subtle px-2 py-0.5 rounded">ESC</span>
        </div>

        <div className="max-h-[420px] overflow-y-auto py-1">
          {items.map((it, i) => <Item key={i} item={it} />)}
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-t border-border text-xs text-text-3">
          <div className="flex gap-3">
            <span><kbd className="kbd">↑↓</kbd> 选择</span>
            <span><kbd className="kbd">↵</kbd> 执行</span>
            <span><kbd className="kbd">⌘I</kbd> AI 模式</span>
            <span><kbd className="kbd">/</kbd> 全局搜索</span>
          </div>
          <div>绑当前需求 · ⌘⇧K 切全局</div>
        </div>
      </div>
    </div>
  );
}

function Item({ item }: { item: { icon: string; label: string; desc?: string; shortcut?: string[] } }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2 cursor-pointer text-md hover:bg-bg-subtle">
      <div className="w-7 h-7 rounded-md bg-bg-subtle flex items-center justify-center text-sm text-text-2">{item.icon}</div>
      <div className="flex-1">
        <div className="text-text-1">{item.label}</div>
        {item.desc && <div className="text-xs text-text-3">{item.desc}</div>}
      </div>
      {item.shortcut && <span className="inline-flex gap-0.5">{item.shortcut.map(k => <kbd key={k} className="kbd">{k}</kbd>)}</span>}
    </div>
  );
}

// 占位 mock 列表（Step 2 内增长；P1+ 接真实命令清单 / AI 检索）
const ALL = [
  { icon: '▶', label: '运行 code-stage Skill', desc: '继续执行下一个 Task（当前 #12 退款接口开发）', shortcut: ['⌘', 'R'] },
  { icon: '⏸', label: '暂停当前 Skill', desc: '保存 AI 会话上下文到 conversations/' },
  { icon: '⟳', label: '重新运行 code-stage', desc: '丢弃当前进度，重新执行' },
  { icon: '📄', label: '打开 design/02-api.md', desc: '当前需求 · 设计阶段 · API 定义' },
  { icon: '📦', label: '打开 artifacts/refund.sql', desc: '产物 · 5 分钟前由 design-stage 生成' },
  { icon: '⌘⇧E', label: '在 IDEA 打开 refund-service worktree', desc: '~/.aidevspace/requirements/req-2024-007/refund-service', shortcut: ['⌘', '⇧', 'E'] },
  { icon: '📚', label: '添加知识：refund-idempotency', desc: '从历史需求沉淀 · 已存在于知识库' },
];
const CMD_FILTERED = (q: string) => ALL.filter(i => i.label.includes(q));
const AI_SUGGEST = (q: string) => [{ icon: '✨', label: `AI: "${q}"` }];
```

- [ ] **Step 5: 14 ShortcutsCheatsheet**

源 HTML：[`docs/design/pages/14-shortcuts-cheatsheet.html`](../../../docs/design/pages/14-shortcuts-cheatsheet.html)

实现要点：键盘分组（命令 / 导航 / 视图），每组若干行 `<kbd>` + 描述。`useUIOverlay()` 接 `cmdSlash`。

- [ ] **Step 6: 15 NewRequirementModal**

源 HTML：[`docs/design/pages/15-new-requirement-modal.html`](../../../docs/design/pages/15-new-requirement-modal.html)

实现要点：弹窗式 backdrop + modal 框，输入字段 PRD 来源（本地路径选择 / URL / 粘贴文本），下一步按钮 → 触发 `requirements.push(newReq)` 并跳转 `/requirements/:newId`（Step 2 仅 push mock；P1+ Agent 接通）。

- [ ] **Step 7: 验证**

打开 `http://localhost:3333`：
- 按 `Cmd+K` → 弹出 CommandPalette（backdrop blur + 三段式 palette + 命令列表）
- 按 `Cmd+/` → 弹出 ShortcutsCheatsheet
- 按 `Cmd+N` → 弹出 NewRequirementModal
- 按 `Esc` → 任一 overlay 关闭

打开 `http://localhost:3333/dev/tokens`：按 `Cmd+K` **不**弹（dev 页面不在 UIOverlayProvider 内 → 不响应键盘）。

- [ ] **Step 8: Commit**

```bash
corepack pnpm typecheck
git add apps/web/src/components/{ui-overlay-store,command-palette,shortcuts-cheatsheet,new-requirement-modal,keyboard-bridge}.tsx
git add apps/web/src/app/\(workspace\)/layout.tsx
git commit -m "feat(web): 加 3 层叠 overlay（CommandPalette / ShortcutsCheatsheet / NewRequirementModal）与 UIOverlayProvider"
```

---

## Self-Review（作者自审清单）

**1. Spec coverage：** 12 路由（Task 5/6/7/8）+ 3 overlay（Task 9）+ 共享组件库（Task 4）+ workspace shell（Task 2/3）+ Brand 6 阶梯（Task 1）+ 不引依赖 + 主题切换 + dev 页面隔离 — spec 第 §Scope / §Out of Scope / §Acceptance / §Dependencies 各小节均有对应 task。

**2. Placeholder scan：**
- ❌ 无 "TBD" / "TODO" / "implement later" / "fill in details"
- ❌ 无 "similar to Task N" 表述（每代码块独立完整）
- ❌ 无 "写适当错误处理" 等空指令
- ✅ Task 4/5/6/7/8/9 部分代码用 `Step N: 写组件 X` 形式，但每步都给了完整 TypeScript code 块，无 placeholder。

**3. Type consistency：**
- `Requirement / Session / InboxItem / Repository / Artifact / AIStatus / RequirementStatus` 类型在 [data/mock.ts](apps/web/src/app/(workspace)/data/mock.ts)（Task 2 创建）后贯穿 Task 4/5/6/7/8/9，命名一致。
- `StatusBadge / AIStatusDot / ProgressBar / RequestCard / ActiveSessionCard / InboxItem` Props 签名与 spec §Shared Components 描述一致。
- `useUIOverlay` 返回 `{ cmdK, cmdSlash, cmdN, open, close }` 在 Task 9 Step 1 定义，Task 9 Step 4/5/6 消费时签名一致。

**4. Plan-vs-Spec 范围匹配：**
- 12 路由：Task 5（首页 01）+ Task 6（02）+ Task 7（03-07 共 5 页）+ Task 8（08-12 共 5 页）= 1+1+5+5 = 12 ✅
- 3 overlay：Task 9 一次性全部 ✅
- 共享组件：Task 4 一次抽齐 8 个 ✅
- Brand 6 阶梯：Task 1 ✅
- workspace shell：Task 2/3 ✅

**5. 已知遗留（不构成 spec gap，留 Step 3+）：**
- Step 9 命令面板的 `Cmd+Shift+K` 当前需求/全局切换（[ADR-0006](docs/adr/0006-html-prototype-as-source-of-truth.md) 提示 P1+）本 Step 不实现。spec §Out of Scope 已声明。
- 历史 commit 字面处理：`/dev/tokens` `/_dev/tokens` 残留 2 处（已 housekeeping）。

---

## Execution Handoff

Plan 已落到 [`docs/superpowers/plans/2026-07-09-frontend-step2-html-port.md`](docs/superpowers/plans/2026-07-09-frontend-step2-html-port.md)。

**两种执行方式（user choice）：**

1. **Subagent-Driven (recommended)** — 我对每个 task 派发独立 subagent，每个 task 完成间做一阶段 review，迭代快
2. **Inline Execution** — 在当前会话按 task 列表逐项执行，关键 check point 暂停 review

请告诉我选哪个；选 1 我会立即切换到 `superpowers:subagent-driven-development` skill。
