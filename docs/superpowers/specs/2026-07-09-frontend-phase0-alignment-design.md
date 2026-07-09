---
Status: ready-for-agent
Type: design
Created: 2026-07-09
Approved: 2026-07-09
Feature: ai-devspace-mvp
Author: Claude (brainstorming session)
Related: PRD.md, UI-POLISH-SPEC.md, CONTEXT.md
---

# 前端 Phase 0 — 契约对齐 + Step 1 设计 Token 开干方案

> 本 spec 是 PRD v1.0 + UI-POLISH-SPEC v1.0 进入前端实施前的"对齐存证"。
> 解决 4 个阻塞级文档冲突 + 锁定 Step 1（Tailwind + CSS variables）的开干细节。

---

## 1. 背景

PRD / UI-POLISH-SPEC / CONTEXT / 4 份 ADR / 11 个 issue 已经写完，但跨文档存在 **契约不一致**，若不先对齐，前后端并行开发会立刻撞墙。

本次对齐只解决**阻塞级冲突**和**Step 1 必须的决策**，不重新讨论产品形态。

---

## 2. 已锁定决策（4 项）

### 决策 A：REST 路径全复数

| 项 | 值 |
|----|----|
| 决议 | **全复数** |
| 影响 | 所有 `/api/*` 路径 |
| 反对方 | issue 03 写法（单数） |
| 依据 | REST 资源命名惯例；UI-POLISH-SPEC §7 已统一为复数 |

**最终路径表**（来源：UI-POLISH-SPEC §7，issue 03 需按此回填）：

```
需求：   GET    /api/requirements
        GET    /api/requirements/:id
        POST   /api/requirements
        PATCH  /api/requirements/:id
        POST   /api/requirements/:id/archive
        POST   /api/requirements/:id/ask        ← AI 提问

仓库：   GET    /api/repos
        POST   /api/repos
        DELETE /api/repos/:name
        GET    /api/requirements/:id/worktrees
        GET    /api/requirements/:id/repos/:repo/diff

知识库： GET    /api/knowledge
        GET    /api/knowledge/*path
        POST   /api/knowledge/*path
        GET    /api/knowledge/search?q=...

规范：   GET    /api/standards
        GET    /api/standards/*path

Skill：  GET    /api/skills
        GET    /api/skills/:name

命令：   GET    /api/commands?context=:id       ← 命令列表（按上下文过滤）
        POST   /api/commands/:id/execute        ← 执行命令（含运行 Skill）

Workspace：
        GET    /api/workspace
        PATCH  /api/workspace/config
        GET    /api/agent/status
```

**影响 issue 03**：需按上表完整回填路由骨架（issue 03 当前只有 5 个，且 `/requirement` 单数 + `/ws/*` 待删）。

### 决策 B：实时通信统一 SSE

| 项 | 值 |
|----|----|
| 决议 | **SSE** |
| 端点 | `GET /sse/requirement/:id`<br>`GET /sse/agent/status`<br>`GET /sse/requirement/:id/output` |
| 反对方 | issue 03（WS）+ ADR-0001（HTTP REST + WebSocket）+ PRD §9（HTTP REST + WebSocket） |
| 依据 | CONTEXT #31 + UI-POLISH-SPEC §6.1-6.2 + §6.3 完整事件格式 + §6.4 TS 契约已就绪 |

**事件类型**（来源：UI-POLISH-SPEC §6.4，`packages/shared/src/sse-events.ts`）：

- `ai.status` — AI 实时状态机（6 态：idle / thinking / tool_calling / writing / awaiting_user / error）
- `ai.output.chunk` — 打字机文本流
- `ai.tool_call` — 工具调用（独立事件，不走打字机）
- `requirement.status` — 需求状态变化
- `artifact.created` / `artifact.updated` — 产物更新
- `error` — 错误推送

**影响**：
- ADR-0001 + PRD §9 段落文字需要更新（"HTTP REST + WebSocket" → "HTTP REST + SSE"）
- issue 03 需删除 `WS /ws/requirement/:id` 路由
- Step 3 `useSSE` hook 直接基于 §6.4 类型实现

### 决策 C：Agent 鉴权 = 动态 Token + Origin

| 项 | 值 |
|----|----|
| 决议 | **动态 Token + Origin 校验** |
| Token 路径 | `~/.aidevspace/.agent-token`（Agent 启动时生成，32 字节 base64url） |
| 权限 | macOS/Linux `chmod 600`；Windows ICACLS 限当前用户 |
| 请求头 | `X-AIDevSpace-Token: <token>`（REST） |
| 端点策略 | REST 验 Token + Origin；SSE 仅验 Origin（EventSource 不能带自定义头） |
| 允许 Origin | `http://localhost:3333`、`http://127.0.0.1:3333` |
| 反对方 | issue 03（"简单的 API Key…静态 token"） |
| 依据 | CONTEXT #34 + UI-POLISH-SPEC §7.5.1 |

**实现细节**（摘自 §7.5.1）：

- `apps/agent/src/auth/token-manager.ts`：读/写 `.agent-token`
- `apps/agent/src/auth/origin-guard.ts`：Fastify 中间件，按 URL 前缀分流
- `apps/web/src/lib/agent-client.ts`：Web 端 fetch 包装（SSR 直读文件，CSR 用 `__INITIAL_DATA__` 注入）
- **SSR/CSR 注入约定**：Web 首次 SSR 时读 token 注入 `__NEXT_DATA__`，CSR 后续从 `window.__INITIAL_DATA__` 取，避免在 CSR 时读 fs

**影响 issue 03**：删除"静态 token"段落，按 §7.5.1 重写。

### 决策 D：需求状态枚举 9 个（含 CLARIFYING）

| 序号 | 状态 | 中文 | 色组 |
|------|------|------|------|
| 1 | `DRAFT` | 草稿 | Neutral 浅灰 |
| 2 | `ANALYZING` | 分析中 | Brand 紫（浅） |
| 3 | `CLARIFYING` | 待澄清 | Brand 紫 + 警告红点 |
| 4 | `DESIGNING` | 设计中 | Brand 紫（浅） |
| 5 | `PLANNING` | 计划中 | Brand 紫（浅） |
| 6 | `IMPLEMENTING` | 实施中 | Brand 紫（实色） |
| 7 | `SUBMITTING` | 提交中 | Warning 橙 |
| 8 | `DONE` | 已完成 | Success 绿 |
| 9 | `ARCHIVED` | 已归档 | Neutral 暗灰 |

- **反对方**：issue 05 列了 8 个（缺 `CLARIFYING`）
- **依据**：UI-POLISH-SPEC §2.1 + CONTEXT #22

**状态色规范**（§2.1）：
- 灰 = 静态（未开始/已归档）
- 紫 = 活跃（5 个"进行中"状态）
- 橙 = 需关注（待澄清/提交中）
- 绿 = 正向结果
- **CLARIFYING 特殊**：紫色 + 右上小红点（"AI 提问待回答"），用户回答后自动消除

**MVP 不带数字徽章**（如 "3/7"），P2 再加。

**驱动方式**：由 Skill 触发（CONTEXT #15 + PRD #10），但前端需要一个兜底枚举用于 UI 渲染。issue 05 的"状态写死"应改为"Skill 驱动 + 枚举兜底"。

**归档行为（ARCHIVED 不限制能力）**：归档仅作为状态枚举的一个值，不在 API / UI 层限制任何后续操作 —— archived 需求仍可 ask、可 diff、可继续推进状态。归档与"删除"是两条独立路径（归档走 `POST /api/requirements/:id/archive`，删除走未来的 `DELETE /api/requirements/:id`，不在本 spec 范围）。

**影响 issue 05**：
- meta.yaml 状态枚举加入 `CLARIFYING`
- 删除"MVP 写死 8 个"的段落，改为"枚举兜底 9 个，实际转换由 Skill 驱动"

---

## 3. Step 1 实施详情（Tailwind + CSS variables）

> **本 spec 范围声明**：Step 1 包含两部分 —— **3.0 脚手架前提**（最小可运行 monorepo）与 **3.1-3.6 Token & Tailwind 接入**。脚手架属于"不可绕过的前置条件"，没有它后面所有步骤都跑不起来。

### 3.0 脚手架前提（最小 monorepo）

**目标**：让 `pnpm dev` 在 `apps/web/` 起一个空 Next.js 14 App Router 页面，`packages/shared/` 能被引用；Token 配置完成后 `/_dev/tokens` 测试页可访问。

#### 3.0.1 仓库根文件

```yaml
# pnpm-workspace.yaml（仓库根）
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// package.json（仓库根）
{
  "name": "ai-devspace",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev:web": "pnpm --filter @ai-devspace/web dev",
    "dev:agent": "pnpm --filter @ai-devspace/agent dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  }
}
```

```json
// tsconfig.base.json（仓库根）
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "jsx": "preserve"
  }
}
```

#### 3.0.2 apps/web 初始化（Next.js 14 App Router）

```bash
# 在 apps/web/ 下
pnpm init
# 安装：next@^14, react@^18, react-dom@^18, typescript, @types/*
# 手动写 next.config.mjs（不跑 create-next-app，避免引入不需要的样板）
```

最小文件清单：
- `apps/web/package.json`：`"dev": "next dev -p 3333"`, `"build": "next build"`, `"start": "next start -p 3333"`
- `apps/web/next.config.mjs`：transpilePackages 含 `@ai-devspace/shared`
- `apps/web/tsconfig.json`：继承 `../../tsconfig.base.json`，加 `"plugins": [{ "name": "next" }]`
- `apps/web/src/app/layout.tsx`：根布局（本 spec §3.4）
- `apps/web/src/app/page.tsx`：占位首页（"AI-DevSpace — Step 1 OK"）
- `apps/web/src/app/_dev/tokens/page.tsx`：仅 `process.env.NODE_ENV === 'development'` 渲染的测试页（§3.5 验收项）

#### 3.0.3 packages/shared 初始化

```json
// packages/shared/package.json
{
  "name": "@ai-devspace/shared",
  "version": "0.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

```ts
// packages/shared/src/index.ts（Step 1 仅占位）
export const SHARED_PACKAGE_OK = true;
```

> Step 3 会在此加 `sse-events.ts`、Zod schema 等。本步只要保证 monorepo 解析通顺即可。

#### 3.0.4 apps/web 依赖 Tailwind（最小集，本步真正安装）

```bash
pnpm --filter @ai-devspace/web add -D \
  tailwindcss@^3.4 postcss autoprefixer \
  tailwindcss-animate@^1.0 \
  next-themes@^0.3
pnpm --filter @ai-devspace/web add clsx tailwind-merge class-variance-authority
```

> **shadcn/ui CLI 不在本步运行**。`components.json` 留空壳，shadcn 组件真正安装放到 Step 2。

#### 3.0.5 脚手架验收（先于 §3.5）

- [ ] `pnpm install` 在仓库根成功
- [ ] `pnpm --filter @ai-devspace/web dev` 启动，`http://localhost:3333` 返回 200（占位首页可访问）
- [ ] `apps/web/src/app/page.tsx` 能 `import { SHARED_PACKAGE_OK } from '@ai-devspace/shared'` 通过 TypeScript 检查
- [ ] `pnpm typecheck` 在仓库根通过

### 3.1 文件结构

```
ai-devspace/
├── pnpm-workspace.yaml          # 3.0.1
├── package.json                 # 3.0.1
├── tsconfig.base.json           # 3.0.1
├── apps/
│   └── web/
│       ├── package.json
│       ├── next.config.mjs
│       ├── tsconfig.json
│       ├── tailwind.config.ts   # ★ 映射 CSS variables
│       ├── postcss.config.js
│       ├── components.json      # shadcn/ui 配置（Step 2 用，本步建空壳）
│       └── src/
│           ├── app/
│           │   ├── layout.tsx   # ThemeProvider 接入（3.4）
│           │   ├── page.tsx     # 占位首页
│           │   └── _dev/tokens/page.tsx   # 仅 dev 环境（3.5）
│           └── styles/
│               ├── tokens.css   # ★ 全部 CSS variables（A+B 两段）
│               └── globals.css  # @tailwind base/components/utilities + 引用 tokens.css
└── packages/
    └── shared/
        ├── package.json
        └── src/
            └── index.ts         # Step 1 占位
```

### 3.2 tokens.css 内容（A+B 两段）

**A 段：基础 token（所有主题共用，§1.5）**

```css
/* 间距（4 倍数） */
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;

/* 字号（9 档） */
--text-xs:   11px;
--text-sm:   12px;
--text-base: 13px;
--text-md:   14px;
--text-lg:   16px;
--text-xl:   18px;
--text-2xl:  20px;
--text-3xl:  24px;
--text-4xl:  32px;

/* 行高（行内 + 行间距） */
--row-sm:   28px;
--row-md:   32px;
--row-lg:   36px;
--row-xl:   40px;
--row-2xl:  48px;
--leading-tight:   1.25;
--leading-normal:  1.5;
--leading-relaxed: 1.7;

/* 圆角（4 档） */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-xl: 12px;

/* 阴影（仅浮层用） */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
--shadow-md: 0 2px 4px rgba(0,0,0,0.06);
--shadow-lg: 0 4px 12px rgba(0,0,0,0.08);
--shadow-xl: 0 8px 24px rgba(0,0,0,0.12);

/* 字体族（§1.4） */
--font-sans: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, monospace;

/* 语义色（§1.3） */
--success-500: 22 92% 46%;   /* #16a34a */
--warning-500: 38 92% 50%;   /* #f59e0b */
--error-500:   0 84% 60%;    /* #ef4444 */
--info-500:    215 16% 47%;  /* #64748b */
```

**A 段补**：Brand 10 阶色板（§1.2）放 Step 2 的 shadcn 初始化里做，因为 shadcn CLI 会自动从 `components.json` 读 `--primary`，本步先留 TODO 占位即可。**这是本 spec 的边界**。

**B 段：主题 token（亮/暗切换，HSL 三元组形式）**

```css
:root {                               /* light (default) */
  --background:           0 0% 100%;
  --foreground:           222 47% 11%;
  --card:                  0 0% 100%;
  --card-foreground:      222 47% 11%;
  --popover:               0 0% 100%;
  --popover-foreground:   222 47% 11%;
  --primary:               234 56% 60%;          /* #5e6ad2, HSL 精确值 */
  --primary-foreground:   0 0% 100%;
  --secondary:             210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted:                 210 40% 96%;
  --muted-foreground:      215 16% 47%;
  --accent:                234 100% 96%;          /* brand-50（占位近似值） */
  --accent-foreground:     234 56% 30%;
  --destructive:           0 84% 60%;             /* #ef4444 */
  --destructive-foreground: 0 0% 100%;
  --border:                214 32% 91%;
  --input:                 214 32% 91%;
  --ring:                  234 56% 60%;
  --color-bg-hover:        210 40% 98%;
  --color-text-muted:      215 16% 47%;
}

.dark {                               /* dark */
  --background:           222 47% 6%;
  --foreground:           210 40% 98%;
  --card:                  222 47% 8%;
  --card-foreground:      210 40% 98%;
  --popover:               222 47% 8%;
  --popover-foreground:   210 40% 98%;
  --primary:               234 70% 70%;          /* #7c87e8, HSL 精确值 */
  --primary-foreground:   222 47% 6%;
  --secondary:             217 33% 17%;
  --secondary-foreground: 210 40% 98%;
  --muted:                 217 33% 17%;
  --muted-foreground:      215 20% 65%;
  --accent:                234 30% 20%;          /* 占位近似值 */
  --accent-foreground:     234 70% 80%;
  --destructive:           0 63% 50%;
  --destructive-foreground: 210 40% 98%;
  --border:                217 33% 17%;
  --input:                 217 33% 17%;
  --ring:                  234 70% 70%;
  --color-bg-hover:        217 33% 14%;
  --color-text-muted:      215 20% 65%;
}
```

**C 段（不在本步范围）**：需求 9 状态色（§2.1）、AI 6 状态色（§3.1）、进度环色——属于组件级 token，等 Step 2 拿到 shadcn 后写在 `StatusBadge.tsx` / `AIStatusDot.tsx` 内部。

> **精度说明**：上述 `--primary` / `--ring` 的 HSL 值是手算复核后的精确值（`#5e6ad2` → `234 56% 60%`，`#7c87e8` → `234 70% 70%`）。Step 1 真正写 token 时建议用色卡工具（如 https://hslpicker.com/）再核一次。`--accent` 系列是 brand-50 的占位近似，等 Step 2 shadcn 初始化时让 CLI 自动生成。

### 3.3 tailwind.config.ts 关键 mapping

```ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],                 // 与 next-themes 的 class 策略一致
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        // ... 其余 shadcn 标准命名
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
      },
      spacing: {
        '1': 'var(--space-1)',  '2': 'var(--space-2)',  '3': 'var(--space-3)',
        '4': 'var(--space-4)',  '5': 'var(--space-5)',  '6': 'var(--space-6)',
        '8': 'var(--space-8)', '10': 'var(--space-10)','12': 'var(--space-12)',
      },
      fontSize: {
        xs:   ['var(--text-xs)',   'var(--leading-tight)'],
        sm:   ['var(--text-sm)',   'var(--leading-tight)'],
        base: ['var(--text-base)', 'var(--leading-normal)'],
        md:   ['var(--text-md)',   'var(--leading-normal)'],
        lg:   ['var(--text-lg)',   'var(--leading-normal)'],
        xl:   ['var(--text-xl)',   'var(--leading-normal)'],
        '2xl':['var(--text-2xl)',  'var(--leading-normal)'],
        '3xl':['var(--text-3xl)',  'var(--leading-normal)'],
        '4xl':['var(--text-4xl)',  'var(--leading-normal)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],     // shadcn 需要
} satisfies Config
```

### 3.4 next-themes 接入

```tsx
// apps/web/src/app/layout.tsx
import { ThemeProvider } from 'next-themes'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### 3.5 Step 1 验收清单

- [ ] `pnpm dev` 启动成功，`http://localhost:3333` 返回 200
- [ ] `apps/web/src/styles/tokens.css` 包含 A+B 两段（brand 10 阶留 TODO）
- [ ] `apps/web/tailwind.config.ts` 完整 mapping 上文 3.3 节
- [ ] `apps/web/src/app/layout.tsx` 接入 next-themes（attribute=class, defaultTheme=system）
- [ ] 临时 `/_dev/tokens` 测试页（仅 dev 环境）网格展示：间距 / 字号 / 圆角 / 阴影 / 主题色
- [ ] 三档主题切换（System / Dark / Light）实时生效，无 FOUC
- [ ] shadcn 所需的 `--background/foreground/primary/...` 全部就位
- [ ] `package.json` 锁定：tailwindcss ^3.4、next-themes ^0.3、tailwindcss-animate ^1.0

### 3.6 不在 Step 1 范围

- shadcn/ui 实际组件安装（→ Step 2）
- Brand 10 阶色板的精确色值（→ Step 2 处理；本步用 `--primary` 一个值代表）
- 组件级 token（9 状态色 / AI 6 状态 / 进度环色）→ Step 2 组件时处理
- 字体文件实际下载（→ Step 2 用 `next/font/google` 正式接入）
- 命令面板 / 状态条 / Toast 组件实现（→ Step 4-6）

---

## 4. 影响范围与回填任务（不在本 spec 直接解决，但需要登记）

| 对象 | 需要改什么 | 优先级 |
|------|-----------|--------|
| **issue 03**（Agent 骨架） | 重写路由表：全复数、删 WS、加 `/sse/*`、鉴权改动态 Token + Origin | 高（Step 1-3 都依赖） |
| **issue 05**（需求 CRUD） | meta.yaml 状态枚举加 `CLARIFYING`；删"写死 8 个"段落；本 spec 决策 D 加注"ARCHIVED 不限制能力" | 中（影响布局组件） |
| **issue 06 / 07 / 11** | 路径前缀 `/api/requirement` → `/api/requirements`；订阅 `WS` → `SSE` | 高 |
| **monorepo 脚手架** | 当前仓库无 `apps/` `packages/`，需按 §3.0 创建 pnpm workspace + Next.js 14 + Tailwind 初始集 | 高（本 spec Step 1 前置） |
| **ADR-0001** | "HTTP REST + WebSocket" → "HTTP REST + SSE" | 低（文档级） |
| **PRD §9** | "HTTP REST + WebSocket" → "HTTP REST + SSE" | 低 |
| **PRD §6.2/§6.3** | "右栏 360px AI 助手" 描述过时，但 §5.1 IA 树仍正确，仅段落需加注 "UI-POLISH-SPEC §4.1 取消右栏常驻" | 低 |
| **issues 12-21** | UI-POLISH-SPEC §12 列出但文件未创建；本会话 6 步全部对应这 10 个 issue | 高（开工前补） |

---

## 5. 验收

- [ ] 4 个阻塞级契约决议（本 spec §2）全部明确，Agent 与 Web 双方按此实现
- [ ] Step 1 验收清单（本 spec §3.5）全部通过
- [ ] issue 03、05、06、07、11 回填任务登记完毕（不要求本会话完成）
- [ ] issues 12-21 创建完毕（或登记在下一会话 backlog）

---

## 6. 不在范围内

- 不重写 PRD / UI-POLISH-SPEC / CONTEXT 任何段落（仅登记回填任务）
- 不实现 Step 2-6 的任何组件
- 不解决 §1 表格中标记为"文档级 / 影响级"的项（仅登记）
- 不动 Agent 进程骨架以外的 Agent 代码
