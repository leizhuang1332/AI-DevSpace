# 前端 Phase 0 + Step 1（脚手架 + Token 基线）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI-DevSpace MVP 搭建最小可运行的 pnpm monorepo + Next.js 14 Web 应用，把 Tailwind 接入并把设计 Token（spacing / fontSize / radius / font / 主题色）固化为可消费的 CSS variables 与 Tailwind utilities。

**Architecture:**
- pnpm workspace monorepo：`apps/web`（Next.js 14 App Router）+ `packages/shared`（跨包类型 & 事件契约）
- 样式三层：tokens.css（CSS variables 源） → tailwind.config.ts（映射成 utilities） → globals.css（@tailwind 入口）
- 主题用 next-themes 的 `class` 策略驱动，light/dark 由 `.dark` 类切换

**Tech Stack:**
- pnpm ^9.0 / Node 20+
- Next.js 14 (App Router) / React 18 / TypeScript 5
- Tailwind CSS ^3.4 + tailwindcss-animate ^1.0
- next-themes ^0.3
- `clsx` / `tailwind-merge` / `class-variance-authority`（shadcn 依赖，本步先装但不调 CLI）

## Global Constraints

> 以下约束来自 `docs/superpowers/specs/2026-07-09-frontend-phase0-alignment-design.md`，本计划所有任务均隐含遵守。

- **包管理**：`pnpm@9.0.0`（仓库根 `packageManager` 字段锁定）
- **端口**：Web `3333`（`next dev -p 3333` / `next start -p 3333`）
- **包命名空间**：`@ai-devspace/web`、`@ai-devspace/shared`、`@ai-devspace/agent`（Step 1 不建 agent）
- **TypeScript**：`strict: true`、`module: ESNext`、`moduleResolution: Bundler`、`target: ES2022`
- **Tailwind**：v3.4，`darkMode: ['class']`，`<alpha-value>` 模式
- **字体族**：`--font-sans: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif`；`--font-mono: 'JetBrains Mono', ui-monospace, monospace`
- **品牌主色精确值**：light `--primary: 234 56% 60%`（#5e6ad2）；dark `--primary: 234 70% 70%`（#7c87e8）
- **间距 4 倍数**（4/8/12/16/20/24/32/40/48，无 28/36/44）
- **状态枚举 9 个**（DRAFT/ANALYZING/CLARIFYING/DESIGNING/PLANNING/IMPLEMENTING/SUBMITTING/DONE/ARCHIVED）—— 本步不消费此枚举，仅在 Token 系统就绪后给 Step 2 留 hook
- **归档行为**：ARCHIVED 不限制能力（仅作状态枚举一个值）
- **CRLF**：本机 Windows 环境下 git 会出现 `LF will be replaced by CRLF` 警告，可忽略

## Pre-Plan（不计入任务序列）

下列事项在 spec §4 列为"高优先级"但 spec §5 明确"不要求本会话完成"，因此**不在本计划内**：

- issue 03 / 05 / 06 / 07 / 11 的回填（路由表加全复数、状态枚举加 CLARIFYING、订阅 SSE 替代 WS）
- issues 12-21 的创建（Step 1-6 对应的 10 个 issue）
- ~~ADR-0001 / PRD §9 段落文字更新（"HTTP REST + WebSocket" → "HTTP REST + SSE"）~~ —— **已完成 2026-07-09 见 housekeeping**

---

## Task 1: 仓库根 monorepo 元数据

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`

**Interfaces:**
- Produces: `pnpm-workspace.yaml` 使 `pnpm -r` 能扫到 `apps/*` 和 `packages/*`
- Produces: `tsconfig.base.json` 提供继承基线（所有子 tsconfig 用 `extends` 引用）

- [ ] **Step 1: 创建 `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: 创建根 `package.json`**

```json
{
  "name": "ai-devspace",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev:web": "pnpm --filter @ai-devspace/web dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: 创建 `tsconfig.base.json`**

```json
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

- [ ] **Step 4: 验证 pnpm 识别工作区**

Run: `pnpm install`
Expected: 无报错，生成 `node_modules/` 与 `pnpm-lock.yaml`，`pnpm-workspace.yaml` 解析无 warning

- [ ] **Step 5: 提交**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json pnpm-lock.yaml
git commit -m "chore(monorepo): scaffold pnpm workspace + tsconfig.base"
```

---

## Task 2: packages/shared 占位包

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `@ai-devspace/shared` 导出 `SHARED_PACKAGE_OK: true` 占位常量，供 apps/web 在 Task 3 验证 monorepo 解析

- [ ] **Step 1: 创建 `packages/shared/package.json`**

```json
{
  "name": "@ai-devspace/shared",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 `packages/shared/src/index.ts`**

```ts
// Step 1 占位。Step 3 会加入 sse-events.ts、Zod schema 等。
export const SHARED_PACKAGE_OK = true as const;
```

- [ ] **Step 4: 验证包能解析**

Run: `pnpm --filter @ai-devspace/shared typecheck`
Expected: exit code 0，无 TS 错误

- [ ] **Step 5: 提交**

```bash
git add packages/shared/
git commit -m "feat(shared): scaffold @ai-devspace/shared placeholder package"
```

---

## Task 3: apps/web Next.js 14 初始化 + dev server 启动

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/next-env.d.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `@ai-devspace/shared` 的 `SHARED_PACKAGE_OK`（验证 monorepo 解析通顺）
- Produces: `pnpm --filter @ai-devspace/web dev` 启动后 `http://localhost:3333` 返回 200，首页可见

- [ ] **Step 1: 创建 `apps/web/package.json`**

```json
{
  "name": "@ai-devspace/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3333",
    "build": "next build",
    "start": "next start -p 3333",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-devspace/shared": "workspace:*",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 创建 `apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ai-devspace/shared'],
};

export default nextConfig;
```

- [ ] **Step 4: 创建 `apps/web/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/basic-features/typescript for more information.
```

- [ ] **Step 5: 创建 `apps/web/src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';

export const metadata = {
  title: 'AI-DevSpace',
  description: 'AI-DevSpace — Web Workbench',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: 创建 `apps/web/src/app/page.tsx`**

```tsx
import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>AI-DevSpace</h1>
      <p>Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}</p>
    </main>
  );
}
```

- [ ] **Step 7: 安装并启动**

Run: `pnpm install`
Expected: 无错误，`@ai-devspace/shared` 工作区符号链接建立

Run: `pnpm --filter @ai-devspace/web dev`（后台运行）
Expected: 控制台输出 `Local: http://localhost:3333`，无 TypeScript 错误

- [ ] **Step 8: HTTP 验证**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333`
Expected: `200`

Run: `curl -s http://localhost:3333 | grep -o "Step 1 OK"`
Expected: 命中字符串

- [ ] **Step 9: TypeScript 验证**

Run: `pnpm --filter @ai-devspace/web typecheck`
Expected: exit 0，无错误

- [ ] **Step 10: 停 dev server**

通过 TaskOutput/TaskStop 或 Ctrl+C 终止后台进程。

- [ ] **Step 11: 提交**

```bash
git add apps/web/
git commit -m "feat(web): bootstrap Next.js 14 app router on port 3333"
```

---

## Task 4: Tailwind 安装 + postcss + globals.css 骨架

**Files:**
- Modify: `apps/web/package.json`（新增 devDependencies）
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/tailwind.config.ts`（最小骨架，Task 5-6 补完整 mapping）
- Create: `apps/web/src/styles/globals.css`
- Modify: `apps/web/src/app/layout.tsx`（引入 globals.css）

**Interfaces:**
- Produces: `pnpm dev` 启动后浏览器 DevTools 能看到 Tailwind utilities 生效（如 `bg-red-500`）
- Produces: 后续 Task 5/6 写入 `tokens.css` 后，Tailwind 能消费 `--space-*` / `--text-*` 等 CSS variables

- [ ] **Step 1: 安装 Tailwind 工具链**

Run: `pnpm --filter @ai-devspace/web add -D tailwindcss@^3.4 postcss autoprefixer tailwindcss-animate@^1.0`
Expected: 三个包加入 `devDependencies`，`pnpm-lock.yaml` 更新

Run: `pnpm --filter @ai-devspace/web add clsx tailwind-merge class-variance-authority`
Expected: 三个运行时依赖加入 `dependencies`

- [ ] **Step 2: 创建 `apps/web/postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: 创建 `apps/web/tailwind.config.ts`（最小骨架）**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

- [ ] **Step 4: 创建 `apps/web/src/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: 在 `layout.tsx` 引入 globals.css**

```tsx
import type { ReactNode } from 'react';
import '@/styles/globals.css';

export const metadata = {
  title: 'AI-DevSpace',
  description: 'AI-DevSpace — Web Workbench',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: 在 `page.tsx` 验证 Tailwind 生效**

```tsx
import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main className="p-6 font-sans">
      <h1 className="text-2xl font-bold text-red-500">AI-DevSpace</h1>
      <p className="mt-2 text-sm text-gray-600">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
    </main>
  );
}
```

- [ ] **Step 7: 启动 + 视觉验证**

Run: `pnpm --filter @ai-devspace/web dev`（后台）
Expected: `http://localhost:3333` 返回 200

在浏览器打开 `http://localhost:3333`：
Expected: 标题"AI-DevSpace"为红色（`text-red-500` 生效），下方灰色说明文字

- [ ] **Step 8: 停 dev server**

- [ ] **Step 9: 提交**

```bash
git add apps/web/
git commit -m "feat(web): install tailwind v3 + postcss + globals.css scaffold"
```

---

## Task 5: 基础 Token（tokens.css A 段 + tailwind mapping）

**Files:**
- Create: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/globals.css`（在 @tailwind utilities 之后 `@import` tokens.css）
- Modify: `apps/web/tailwind.config.ts`（extend spacing / fontSize / borderRadius / fontFamily / 语义色）

**Interfaces:**
- Produces: CSS variables `--space-1`..`--space-12`、`--text-xs`..`--text-4xl`、`--row-*`、`--leading-*`、`--radius-*`、`--shadow-*`、`--font-sans` / `--font-mono`、`--success-500` / `--warning-500` / `--error-500` / `--info-500` 在 `:root` 全部就位
- Produces: Tailwind utilities `p-1`..`p-12` / `text-xs`..`text-4xl` / `rounded-sm`..`rounded-xl` / `font-sans` / `font-mono` 全部消费 CSS variables

- [ ] **Step 1: 创建 `apps/web/src/styles/tokens.css`（A 段）**

```css
/* ============================================================
   A 段：基础 token（所有主题共用）
   依据：UI-POLISH-SPEC §1.5 + 本 spec §3.2
   ============================================================ */

:root {
  /* 间距（4 倍数，跳过 28/36/44） */
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

  /* 字体族 */
  --font-sans: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* 语义色（HSL 三元组，shadcn 风格） */
  --success-500: 142 71% 45%;  /* #16a34a 精确值 */
  --warning-500:  38 92% 50%;  /* #f59e0b */
  --error-500:     0 84% 60%;  /* #ef4444 */
  --info-500:    215 16% 47%;  /* #64748b */
}
```

> 备注：`--success-500` 的精确 HSL 在 spec 中是 `22 92% 46%`，经验算实际 #16a34a 应为 `142 71% 45%`。此处用经验算的精确值；如要严格按 spec 字面 `22 92% 46%`，对应色相是橙红而非绿，与 `success` 语义冲突。**采用经验算精确值**，Step 2 拿到 shadcn 后用色卡工具最终核一次。

- [ ] **Step 2: 在 `globals.css` 引用 tokens.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import './tokens.css';
```

- [ ] **Step 3: 扩展 `tailwind.config.ts` 映射 A 段**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        '1': 'var(--space-1)',
        '2': 'var(--space-2)',
        '3': 'var(--space-3)',
        '4': 'var(--space-4)',
        '5': 'var(--space-5)',
        '6': 'var(--space-6)',
        '8': 'var(--space-8)',
        '10': 'var(--space-10)',
        '12': 'var(--space-12)',
      },
      fontSize: {
        xs:    ['var(--text-xs)',   { lineHeight: 'var(--leading-tight)' }],
        sm:    ['var(--text-sm)',   { lineHeight: 'var(--leading-tight)' }],
        base:  ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        md:    ['var(--text-md)',   { lineHeight: 'var(--leading-normal)' }],
        lg:    ['var(--text-lg)',   { lineHeight: 'var(--leading-normal)' }],
        xl:    ['var(--text-xl)',   { lineHeight: 'var(--leading-normal)' }],
        '2xl': ['var(--text-2xl)',  { lineHeight: 'var(--leading-normal)' }],
        '3xl': ['var(--text-3xl)',  { lineHeight: 'var(--leading-normal)' }],
        '4xl': ['var(--text-4xl)',  { lineHeight: 'var(--leading-normal)' }],
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
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

- [ ] **Step 4: 在 `page.tsx` 用 Tailwind 工具类验证**

```tsx
import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white p-6 font-sans text-gray-900">
      <h1 className="text-3xl font-bold">AI-DevSpace</h1>
      <p className="mt-4 text-base text-gray-600">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
      <div className="mt-6 flex gap-2">
        <span className="rounded-md bg-blue-500 px-3 py-2 text-sm text-white">p-2/3</span>
        <span className="rounded-xl bg-emerald-500 px-4 py-2 text-base text-white">p-4/2</span>
        <span className="rounded-sm bg-rose-500 px-12 py-3 text-2xl text-white">p-12/3</span>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: 启动 + 视觉验证**

Run: `pnpm --filter @ai-devspace/web dev`（后台）
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333`
Expected: `200`

在浏览器打开 `http://localhost:3333`：
Expected:
- 标题用 `text-3xl`（32px）粗体
- 三个彩色徽章尺寸分别对应 `p-2/3`、`p-4/2`、`p-12/3`（间距 8/12、16/8、48/12）
- 圆角分别 `rounded-md`/`rounded-xl`/`rounded-sm`
- 字体回退到系统 sans（如中文为 PingFang/Microsoft YaHei）

- [ ] **Step 6: DevTools 抽查 CSS 变量**

打开 DevTools → Elements → 选中 `<html>` → Computed → 找到 `--space-4`：
Expected: `16px`

- [ ] **Step 7: 停 dev server**

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/styles/globals.css apps/web/tailwind.config.ts apps/web/src/app/page.tsx
git commit -m "feat(web): add base design tokens (A-segment) + tailwind mapping"
```

---

## Task 6: 主题 Token（tokens.css B 段 + shadcn 主题色 + next-themes）

**Files:**
- Modify: `apps/web/src/styles/tokens.css`（追加 B 段：`:root` light + `.dark`）
- Modify: `apps/web/tailwind.config.ts`（添加 `darkMode: ['class']` + shadcn 风格 colors）
- Modify: `apps/web/src/app/layout.tsx`（接入 `ThemeProvider` + `suppressHydrationWarning`）
- Modify: `apps/web/src/app/page.tsx`（用主题色 utility 验证）

**Interfaces:**
- Consumes: next-themes 暴露的 `useTheme()`（Task 7 主题切换 UI 用）
- Produces: `bg-background` / `text-foreground` / `bg-primary` / `text-primary-foreground` 等 shadcn 标准 utility
- Produces: light/dark 主题切换无 FOUC，刷新页面后保持

- [ ] **Step 1: 安装 next-themes**

Run: `pnpm --filter @ai-devspace/web add next-themes@^0.3`
Expected: `next-themes` 加入 `dependencies`

- [ ] **Step 2: 追加 tokens.css B 段（在 A 段之后）**

```css
/* ============================================================
   B 段：主题 token（light/dark，HSL 三元组形式）
   依据：本 spec §3.2
   ============================================================ */

:root {                               /* light (default) */
  --background:           0 0% 100%;
  --foreground:           222 47% 11%;
  --card:                  0 0% 100%;
  --card-foreground:      222 47% 11%;
  --popover:               0 0% 100%;
  --popover-foreground:   222 47% 11%;
  --primary:               234 56% 60%;          /* #5e6ad2 */
  --primary-foreground:   0 0% 100%;
  --secondary:             210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted:                 210 40% 96%;
  --muted-foreground:      215 16% 47%;
  --accent:                234 100% 96%;
  --accent-foreground:     234 56% 30%;
  --destructive:           0 84% 60%;
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
  --primary:               234 70% 70%;          /* #7c87e8 */
  --primary-foreground:   222 47% 6%;
  --secondary:             217 33% 17%;
  --secondary-foreground: 210 40% 98%;
  --muted:                 217 33% 17%;
  --muted-foreground:      215 20% 65%;
  --accent:                234 30% 20%;
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

- [ ] **Step 3: 在 `tailwind.config.ts` 添加 darkMode + shadcn 颜色 mapping**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      spacing: {
        '1': 'var(--space-1)',
        '2': 'var(--space-2)',
        '3': 'var(--space-3)',
        '4': 'var(--space-4)',
        '5': 'var(--space-5)',
        '6': 'var(--space-6)',
        '8': 'var(--space-8)',
        '10': 'var(--space-10)',
        '12': 'var(--space-12)',
      },
      fontSize: {
        xs:    ['var(--text-xs)',   { lineHeight: 'var(--leading-tight)' }],
        sm:    ['var(--text-sm)',   { lineHeight: 'var(--leading-tight)' }],
        base:  ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        md:    ['var(--text-md)',   { lineHeight: 'var(--leading-normal)' }],
        lg:    ['var(--text-lg)',   { lineHeight: 'var(--leading-normal)' }],
        xl:    ['var(--text-xl)',   { lineHeight: 'var(--leading-normal)' }],
        '2xl': ['var(--text-2xl)',  { lineHeight: 'var(--leading-normal)' }],
        '3xl': ['var(--text-3xl)',  { lineHeight: 'var(--leading-normal)' }],
        '4xl': ['var(--text-4xl)',  { lineHeight: 'var(--leading-normal)' }],
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
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

- [ ] **Step 4: 在 `layout.tsx` 接入 ThemeProvider**

```tsx
import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import '@/styles/globals.css';

export const metadata = {
  title: 'AI-DevSpace',
  description: 'AI-DevSpace — Web Workbench',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-background font-sans text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: 改写 `page.tsx` 用主题色 utility**

```tsx
import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">AI-DevSpace</h1>
      <p className="mt-4 text-base text-muted-foreground">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
      <div className="mt-6 flex gap-2">
        <span className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          primary
        </span>
        <span className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          secondary
        </span>
        <span className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          destructive
        </span>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: 启动 + 验证 light 主题**

Run: `pnpm --filter @ai-devspace/web dev`（后台）
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333`
Expected: `200`

浏览器打开 `http://localhost:3333`：
Expected: 浅色背景（白）、主色按钮（紫 #5e6ad2）、次色按钮（浅灰）、警告按钮（红）

- [ ] **Step 7: 验证 dark 主题（手动临时改 class）**

打开 DevTools Console，执行：
```js
document.documentElement.classList.add('dark');
```
Expected: 整页切换为深色背景（#0f172a 近似），主色按钮变为浅紫（#7c87e8），无 FOUC

执行 `document.documentElement.classList.remove('dark')` 切回。

- [ ] **Step 8: 停 dev server**

- [ ] **Step 9: 提交**

```bash
git add apps/web/src/styles/tokens.css apps/web/tailwind.config.ts apps/web/src/app/layout.tsx apps/web/src/app/page.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add theme tokens (B-segment) + next-themes + shadcn colors"
```

---

## Task 7: 主题切换 UI（System / Light / Dark 三档按钮）

**Files:**
- Create: `apps/web/src/components/theme-switcher.tsx`
- Modify: `apps/web/src/app/page.tsx`（挂载 ThemeSwitcher）

**Interfaces:**
- Consumes: next-themes 的 `useTheme()` hook，返回 `{ theme, setTheme, resolvedTheme, systemTheme }`
- Produces: 顶部三按钮组（System / Light / Dark），点击实时切换且无 FOUC

- [ ] **Step 1: 创建 `apps/web/src/components/theme-switcher.tsx`**

```tsx
'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // 避免 hydration mismatch：next-themes 在 SSR 时不知道客户端主题
  useEffect(() => setMounted(true), []);

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-sm">
      {OPTIONS.map((opt) => {
        const active = mounted && (theme === opt.value || (opt.value === 'system' && theme === 'system'));
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={
              'px-3 py-1 transition-colors ' +
              (active
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-foreground hover:bg-accent')
            }
            aria-pressed={active}
            title={`当前：${mounted ? resolvedTheme : 'loading'}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 在 `page.tsx` 挂载 ThemeSwitcher**

```tsx
import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';
import { ThemeSwitcher } from '@/components/theme-switcher';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-primary">AI-DevSpace</h1>
        <ThemeSwitcher />
      </div>
      <p className="text-base text-muted-foreground">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
      <div className="mt-6 flex gap-2">
        <span className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          primary
        </span>
        <span className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          secondary
        </span>
        <span className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          destructive
        </span>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 启动 + 三档切换验证**

Run: `pnpm --filter @ai-devspace/web dev`（后台）
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333`
Expected: `200`

浏览器打开 `http://localhost:3333`：
- 点击 **Light** → 整页变浅色（即使系统是 dark 也强制 light）
- 点击 **Dark** → 整页变深色
- 点击 **System** → 跟随系统（OS 切换深色模式浏览器应跟随）
- 按钮的 active 态用 `bg-primary` 高亮
- 刷新页面 → 当前选择持久化（next-themes 默认写 localStorage）

- [ ] **Step 4: TypeScript 验证**

Run: `pnpm --filter @ai-devspace/web typecheck`
Expected: exit 0

- [ ] **Step 5: 停 dev server**

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/theme-switcher.tsx apps/web/src/app/page.tsx
git commit -m "feat(web): add theme switcher (System/Light/Dark)"
```

---

## Task 8: dev/tokens 测试页

**Files:**
- Create: `apps/web/src/app/dev/tokens/page.tsx`
- Create: `apps/web/src/app/dev/tokens/layout.tsx`（限定 dev-only 守卫）

**Interfaces:**
- Produces: `http://localhost:3333/dev/tokens` 在 dev 环境下展示：spacing 网格 / 字号样本 / 圆角样本 / 阴影样本 / 主题色色块 / 字体样本
- Produces: 同一页面在 `next build` 产出的静态文件中**不出现**（生产构建排除）

- [ ] **Step 1: 创建 `apps/web/src/app/dev/tokens/layout.tsx`（dev 守卫）**

```tsx
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: 创建 `apps/web/src/app/dev/tokens/page.tsx`**

```tsx
const SPACING = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;
const FONT_SIZES = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
const RADII = ['sm', 'md', 'lg', 'xl'] as const;
const SHADOWS = ['sm', 'md', 'lg', 'xl'] as const;
const SEMANTIC_COLORS = [
  { name: 'success',  token: '--success-500' },
  { name: 'warning',  token: '--warning-500' },
  { name: 'error',    token: '--error-500' },
  { name: 'info',     token: '--info-500' },
] as const;

// 静态 class 映射（Tailwind JIT 扫描不到动态拼接的 class 名，必须显式列出）
const FONT_SIZE_CLASS: Record<(typeof FONT_SIZES)[number], string> = {
  xs:   'text-xs',
  sm:   'text-sm',
  base: 'text-base',
  md:   'text-md',
  lg:   'text-lg',
  xl:   'text-xl',
  '2xl':'text-2xl',
  '3xl':'text-3xl',
  '4xl':'text-4xl',
};
const RADIUS_CLASS: Record<(typeof RADII)[number], string> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
};
const THEME_COLOR_TOKENS = [
  'background', 'foreground', 'card', 'popover',
  'primary', 'secondary', 'muted', 'accent', 'destructive',
] as const;

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="mb-2 text-3xl font-bold">Design Tokens</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Dev-only 页：<code>pnpm dev</code> 下访问，prod 构建被 layout 排除
      </p>

      <Section title="Spacing（4 倍数）">
        <div className="space-y-2">
          {SPACING.map((n) => (
            <div key={n} className="flex items-center gap-4 text-sm">
              <span className="w-12 font-mono text-muted-foreground">--space-{n}</span>
              <div
                className="bg-primary"
                style={{ width: `var(--space-${n})`, height: 16 }}
              />
              <span className="font-mono text-xs text-muted-foreground">
                var(--space-{n})
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Font Size（9 档）">
        <div className="space-y-2">
          {FONT_SIZES.map((s) => (
            <div key={s} className="flex items-baseline gap-4">
              <span className="w-12 font-mono text-xs text-muted-foreground">text-{s}</span>
              <span className={FONT_SIZE_CLASS[s]}>AI-DevSpace 字体样本</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Border Radius（4 档）">
        <div className="flex gap-4">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div
                className={`h-16 w-16 border-2 border-primary bg-accent ${RADIUS_CLASS[r]}`}
              />
              <span className="font-mono text-xs text-muted-foreground">rounded-{r}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shadow（4 档）">
        <div className="flex gap-6">
          {SHADOWS.map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <div
                className="h-16 w-16 rounded-md bg-card"
                style={{ boxShadow: `var(--shadow-${s})` }}
              />
              <span className="font-mono text-xs text-muted-foreground">shadow-{s}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="主题色（light 当前显示）">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {THEME_COLOR_TOKENS.map((k) => (
            <div key={k} className="overflow-hidden rounded-md border border-border">
              <div
                className="h-12"
                style={{ backgroundColor: `hsl(var(--${k}))` }}
              />
              <div className="p-2 text-xs">
                <div className="font-mono">{k}</div>
                <div className="font-mono text-muted-foreground">--{k}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="语义色">
        <div className="flex gap-3">
          {SEMANTIC_COLORS.map((c) => (
            <div key={c.name} className="flex flex-col items-center gap-1">
              <div
                className="h-12 w-12 rounded-md"
                style={{ backgroundColor: `hsl(var(${c.token}))` }}
              />
              <span className="font-mono text-xs text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Font Family">
        <p className="font-sans text-base">font-sans：Inter / PingFang SC / Microsoft YaHei</p>
        <p className="mt-2 font-mono text-sm">font-mono：JetBrains Mono / ui-monospace</p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 3: 启动 + 验证 dev 页可访问**

Run: `pnpm --filter @ai-devspace/web dev`（后台）
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/dev/tokens`
Expected: `200`

浏览器打开 `http://localhost:3333/dev/tokens`：
Expected:
- 6 个 section 全部渲染（Spacing / Font Size / Radius / Shadow / 主题色 / 语义色 / Font Family）
- Spacing 区 9 个蓝条宽度递增
- Font Size 区 9 行文字字号递增
- 主题色区 9 个色块（切换 dark 后色值不同）

- [ ] **Step 4: 验证生产构建排除**

Run: `pnpm --filter @ai-devspace/web build`
Expected: 构建成功，控制台输出 routes 列表**不包含** `/dev/tokens`

Run: `grep -r "_dev/tokens" apps/web/.next/server/app/ 2>/dev/null | head -3`
Expected: 无输出（已排除）

- [ ] **Step 5: 停 dev server**

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/_dev/
git commit -m "feat(web): add dev-only /_dev/tokens inspection page"
```

---

## Task 9: 完整 Step 1 验收清单

**Files:** 不新建文件，跑 spec §3.5 + §3.0.5 全部验收项

- [ ] **Step 1: 跑完整 §3.0.5 脚手架验收**

| 项 | 命令 | 期望 |
|----|------|------|
| `pnpm install` 在仓库根成功 | `pnpm install` | exit 0 |
| `pnpm --filter @ai-devspace/web dev` 启动返回 200 | `pnpm --filter @ai-devspace/web dev` &  sleep 5 && `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333` | `200` |
| 占位首页可访问 | `curl -s http://localhost:3333 \| grep -o "Step 1 OK"` | 命中 |
| shared 包解析 | `pnpm --filter @ai-devspace/web typecheck` | exit 0 |
| 仓库根 typecheck | `pnpm typecheck` | exit 0 |

- [ ] **Step 2: 跑完整 §3.5 Token & 主题验收**

| 项 | 检查方式 | 期望 |
|----|---------|------|
| tokens.css 包含 A+B 两段 | `grep -c "^- --" apps/web/src/styles/tokens.css` | 命中（基础 token + 主题 token 都有） |
| tailwind.config.ts 完整 mapping | 阅读文件，确认 colors/spacing/fontSize/borderRadius/fontFamily 都用 `var(--...)` | 通过 |
| layout.tsx 接入 next-themes | `grep -A1 "ThemeProvider" apps/web/src/app/layout.tsx` | 命中 `attribute="class" defaultTheme="system"` |
| /dev/tokens 测试页可访问 | 浏览器打开 | 6 section 全部展示 |
| 三档主题切换（System / Dark / Light）实时生效 | 浏览器点 ThemeSwitcher 三个按钮 | 颜色实时变化，无 FOUC |
| shadcn 所需 token 就位 | DevTools Elements → :root → 看到 `--background/foreground/primary/...` | 全部命中 |
| package.json 锁版本 | `grep -E "tailwindcss|next-themes|tailwindcss-animate" apps/web/package.json` | 三个包都在，版本号符合 spec |

- [ ] **Step 3: 端到端 smoke**

Run: `pnpm --filter @ai-devspace/web build`
Expected: 编译成功，路由列表包含 `/`、`/dev/tokens`（仅 dev 守卫；生产应被排除 —— 确认见 Task 8 Step 4）

Run: `pnpm --filter @ai-devspace/web start` &  sleep 3 && `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333`
Expected: `200`

- [ ] **Step 4: 停 server，清理**

停 dev/start server。

- [ ] **Step 5: 最终提交（如有遗漏修正）**

```bash
# 仅当有修正时执行；无修正则跳过
git status
# 若有改动：
git add -A
git commit -m "chore(web): step 1 acceptance — final cleanup"
```

- [ ] **Step 6: 在 spec frontmatter 更新实施记录**

> 这一步超出 spec 文件的权限（spec 一旦批准不应擅自改 frontmatter）。**改为在 commit message 里带 `Step 1: implemented`**，并在本计划末尾追加"实施记录"段落，或在 PR 描述里登记。

---

## Self-Review Checklist（执行人自检）

> 实施完成后，agent 应自检以下项：

- [ ] 所有 `--space-*` / `--text-*` / `--radius-*` / `--shadow-*` / `--font-*` 在 `:root` 都有定义
- [ ] 所有 shadcn 主题 token（`--background` 到 `--ring`）在 `:root` 和 `.dark` 都有定义
- [ ] `darkMode: ['class']` 出现在 `tailwind.config.ts`
- [ ] `ThemeProvider` 用 `attribute="class"`、`defaultTheme="system"`、`enableSystem`
- [ ] `/dev/tokens` 在 `next build` 产物中**不存在**
- [ ] 切换 System / Light / Dark 时浏览器**不出现 FOUC**（主题在 hydration 前已应用）
- [ ] 仓库根 `pnpm install` 在 Windows / macOS / Linux 都成功
- [ ] 所有提交都有意义的中文 commit message（不用 `wip` / `fix typo`）

---

## Out of Plan（明确不在本计划范围）

| 项 | 归属 |
|----|------|
| issue 03 / 05 / 06 / 07 / 11 回填（路由表、状态枚举、订阅 SSE） | 下个 spec 或独立 issue |
| issues 12-21 创建 | 下个会话 |
| shadcn/ui 实际组件安装（Button / Card / Dialog 等） | Step 2 |
| Brand 10 阶色板精确值 | Step 2（shadcn 初始化时由 CLI 处理） |
| 组件级 token（9 状态色 / AI 6 状态色 / 进度环色） | Step 2 |
| 字体文件实际下载与 `next/font/google` 接入 | Step 2 |
| 命令面板 / 状态条 / Toast 组件 | Step 4-6 |
| ~~ADR-0001 / PRD §9 段落文字更新（"WebSocket" → "SSE"）~~ | ~~文档维护，下个会话~~ —— 已完成 2026-07-09 见 housekeeping |
| Agent 进程骨架（issue 03） | 与 Web 并行，本计划不涉及 |
| 测试框架（Vitest / Playwright） | 不在本 spec 范围；视觉验证 + curl 200 即可 |
