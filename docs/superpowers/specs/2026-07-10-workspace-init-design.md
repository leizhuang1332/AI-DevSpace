# 02 - Workspace Init 设计 spec

**日期**：2026-07-10
**关联 issue**：[`.scratch/ai-devspace-mvp/issues/02-workspace-init.md`](../../../.scratch/ai-devspace-mvp/issues/02-workspace-init.md)
**关联 ADR**：[ADR-0002 纯文件系统作为数据层](../../../docs/adr/0002-filesystem-as-database.md)
**阶段**：MVP 阶段 1 — 地基

---

## 1. 目标

Agent 守护进程启动时自动初始化用户工作空间 `~/.aidevspace/`，并提供 REST API 让 Web 工作台读取工作空间信息和修改 `config.yaml`。

落地 ADR-0002（纯文件系统）；为后续 issue（03 鉴权、05 需求 CRUD、06 仓库 worktree 等）提供可运行的 agent 进程骨架与 settings 页基础设施。

---

## 2. 范围

### In scope（本期实现）

- Agent 启动时自动调用 `initWorkspace()`，幂等
- 三类 API：
  - `GET /api/workspace` — 返回根路径、子目录存在矩阵、`config.yaml` 解析后的对象、`.gitignore` 是否存在
  - `PATCH /api/workspace/config` — 深合并更新 `config.yaml`，返回合并后完整对象
- 自动生成 `~/.aidevspace/.gitignore`（忽略 `logs/`、`*/node_modules/`、`.DS_Store`、`*.log`、`snapshots/`）
- 跨平台路径解析（macOS / Linux / Windows），支持 `AIDEVSPACE_HOME` 环境变量覆盖
- Web 端 `Settings` 页整页接入 config.yaml：5 个 section（外观 / AI 体验 / 工作空间 / Agent 连接 / 危险操作）所有改动回写后端
- Web 端测试基建：Vitest + @testing-library/react + jsdom

### Out of scope（明确剔除）

- 鉴权 token / Origin 强校验（[issue 03](../.scratch/ai-devspace-mvp/issues/03-agent-skeleton.md)）
- 真实 root 路径切换（Settings 页 workspaceRoot 字段本期只读展示）
- 卸载真实执行（danger 区本期为占位 + 二次确认）
- AI provider 切换 UI（[UI-POLISH-SPEC §7.5.2](../../ai-devspace-mvp/UI-POLISH-SPEC.md) MVP 不做）
- snapshot 机制落地（仅在 .gitignore 提前占位，实际功能后续 issue）

---

## 3. 数据契约

### 3.1 `WorkspaceInfo`（`packages/shared/src/workspace.ts`）

```typescript
import { z } from 'zod'

export const ConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])
export type ConfigValue = z.infer<typeof ConfigValueSchema>

export const ConfigSchema = z.record(z.string(), ConfigValueSchema)
export type Config = z.infer<typeof ConfigSchema>

export const WorkspaceInfoSchema = z.object({
  root: z.string(),                              // 物理根路径绝对路径
  exists: z.boolean(),                            // 根目录是否存在
  createdAt: z.number().nullable(),               // 根目录创建时间戳；不存在时 null
  subdirs: z.record(z.string(), z.boolean()),     // { requirements, repos, knowledge, skills, logs } -> 存在?
  configPath: z.string(),                         // config.yaml 绝对路径
  config: ConfigSchema,                           // 解析后的 config（缺 key 用默认值补）
  gitignorePath: z.string(),
  gitignoreExists: z.boolean(),
  diskUsageBytes: z.number().int().nonnegative(), // 根目录递归磁盘占用（字节）
})
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>
```

### 3.2 `ConfigPatch`（PATCH body）

```typescript
export const ConfigPatchSchema = z.record(z.string(), ConfigValueSchema)
export type ConfigPatch = z.infer<typeof ConfigPatchSchema>
```

Patched：缺失 key 自动用 `DEFAULT_CONFIG` 补；用户提供的 key 覆盖默认值；未提供的 key 保留文件原值。

### 3.3 `DEFAULT_CONFIG`（`packages/shared/src/config-defaults.ts`）

```typescript
import type { Config } from './workspace'

export const DEFAULT_CONFIG: Config = {
  theme: 'system',
  typewriterSpeed: 'medium',
  silentWindowSeconds: 30,
  agentEndpoint: 'http://localhost:7777',
  workspaceRoot: '',           // 由 agent 启动时注入实际根路径
  'ai.provider': 'claude-code',
} as const

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as Array<keyof typeof DEFAULT_CONFIG>
```

`workspaceRoot` 在 `initWorkspace` 完成后会被注入为实际路径（确保 settings 页能展示真实位置）。

---

## 4. Agent 端设计

### 4.1 文件布局

```text
apps/agent/src/
├── server.ts                    # 改：boot 时调 initWorkspace
├── services/
│   └── WorkspaceService.ts      # 新：所有 workspace 业务逻辑
├── routes/
│   └── workspace.ts             # 新：GET /api/workspace, PATCH /api/workspace/config
├── __tests__/
│   ├── workspace-service.test.ts   # 新：服务级 red-green
│   └── workspace-route.test.ts     # 新：HTTP 集成测试
```

### 4.2 `WorkspaceService` API

```typescript
import { mkdir, writeFile, readFile, stat, rename, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'yaml'
import type { Config, WorkspaceInfo, ConfigPatch } from '@ai-devspace/shared'

const SUBDIRS = ['requirements', 'repos', 'knowledge', 'skills', 'logs'] as const
const GITIGNORE_CONTENT = [
  '# AI DevSpace workspace',
  'logs/',
  'snapshots/',
  '*/node_modules/',
  '.DS_Store',
  '*.log',
  '',
].join('\n')

export class WorkspaceService {
  constructor(public readonly root: string) {}

  /** 默认根路径：AIDEVSPACE_HOME env > ~/.aidevspace */
  static resolveRoot(env: NodeJS.ProcessEnv = process.env): string {
    return env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')
  }

  /** 幂等初始化；返回新建/已存在的目录与文件 */
  async initWorkspace(): Promise<{
    createdDirs: string[]; existedDirs: string[];
    configCreated: boolean; configBackfilled: boolean;
    gitignoreCreated: boolean;
  }> { /* ... */ }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> { /* ... */ }

  async updateConfig(patch: ConfigPatch): Promise<{ config: Config }> { /* ... */ }

  // 私有
  private async ensureDir(p: string): Promise<'created' | 'existed'>
  private async writeFileAtomic(p: string, content: string): Promise<void>
  private async readConfigFile(): Promise<Config>
  private async writeConfigFile(cfg: Config): Promise<void>
  private deepMerge(base: Config, patch: ConfigPatch): Config
  private async computeDiskUsage(p: string): Promise<number>
}
```

### 4.3 关键行为

| 行为 | 规则 |
|---|---|
| 路径解析 | `WorkspaceService.resolveRoot()` 读 `AIDEVSPACE_HOME`，缺省 `~/.aidevspace` |
| 创建目录 | 5 个子目录（requirements/repos/knowledge/skills/logs）；存在则跳过，不存在则建 |
| 写 `.gitignore` | 缺失时一次性写入完整内容；存在则**不动**（用户可能已加自定义规则） |
| 写 `config.yaml` | 不存在 → 用 `DEFAULT_CONFIG` 序列化（`workspaceRoot` 注入实际路径）；存在 → 解析后 deep-merge `DEFAULT_CONFIG` 补缺 key，用户值保留 |
| `workspaceRoot` 注入 | `initWorkspace` 完成后若 `config.yaml` 里 `workspaceRoot` 缺失或与实际不一致，覆盖为当前 root |
| 读 `config.yaml` | YAML 解析失败 → 抛 `WorkspaceCorruptError`（500 + 日志，**不**自动覆盖） |
| 写盘原子性 | 先写 `<path>.tmp` 再 `rename` |
| 磁盘占用 | 递归遍历根目录累加 size；超过 50k 文件时改为 `du -sk` 子命令（兜底） |
| `updateConfig` | deep-merge patch 到当前 config；YAML round-trip 保持注释和顺序（用 `yaml.Document`） |
| 并发保护 | 单进程内同步执行；本期不做进程间互斥（issue 后续视需要引入 `proper-lockfile`） |

### 4.4 REST 路由

**`GET /api/workspace`** → `WorkspaceInfo`（200）/ 500（异常）

**`PATCH /api/workspace/config`** 
- Body: `ConfigPatch`（任意子集 key）
- 200: `{ ok: true, config: Config }`
- 400: `{ error: 'invalid_patch', details: ZodIssue[] }`
- 500: `{ error: 'internal_error', message: string }`

**`POST /api/workspace/open`**（占位，Web 端"在文件管理器打开"按钮调用）
- Body: `{ path?: string }`（缺省 = 工作空间根）
- 200: `{ ok: true }`
- 实现：本期直接返回 ok，不实际打开。后续 issue 用 `shell.openPath` / `xdg-open` / `explorer` 跨平台实现。

**`POST /api/workspace/uninstall`**（占位，Web 端"卸载"按钮调用）
- 200: `{ ok: true }`
- 实现：本期直接返回 ok + agent log warn。真正删除 `~/.aidevspace/` 在后续 issue 做（需二次确认 + 备份提示）。

**`GET /api/health`**（已存在，验证用）
- 200: `{ ok: true, name: 'agent', workspaceRoot: string }`
- 改：附加 workspaceRoot 字段，方便 Web 健康检查一并拉根路径。

**Error envelope**：
```typescript
type ErrorBody = { error: string; message?: string; details?: unknown }
```

### 4.5 `server.ts` boot 流程

```typescript
// apps/agent/src/server.ts (改后)
import { WorkspaceService } from './services/WorkspaceService.js'

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
  await app.register(cors, { origin: ['http://localhost:3333', 'http://127.0.0.1:3333'], credentials: true })

  const ws = new WorkspaceService(WorkspaceService.resolveRoot())
  app.decorate('workspace', ws)
  await app.register(workspaceRoutes)

  // Boot 时 init（幂等）
  try {
    const initResult = await ws.initWorkspace()
    app.log.info({ ...initResult, root: ws.root }, 'workspace initialized')
  } catch (err) {
    app.log.error({ err, root: ws.root }, 'workspace init failed')
    throw err
  }

  return app
}
```

> **boot init 失败行为**：抛错 → 进程退出（exit 1）。理由：若 workspace 都建不起来，后续任意请求都是无源之水。生产中可用 systemd / launchd 重启。

---

## 5. Web 端设计

### 5.1 文件布局

```text
apps/web/src/
├── lib/
│   ├── agent-client.ts          # 新：fetch 包装
│   └── config-hooks.ts          # 新：useConfig / useUpdateConfig
├── app/(workspace)/settings/
│   ├── page.tsx                 # 改：拆分为 shell + sections
│   ├── settings-shell.tsx       # 新：二栏布局 + 侧导航
│   └── sections/
│       ├── appearance.tsx       # 新：theme + 信息密度
│       ├── ai-experience.tsx    # 新：打字机速度 + 静默窗口
│       ├── workspace.tsx        # 新：根路径（只读）+ 磁盘
│       ├── agent.tsx            # 新：连接状态 + token 占位
│       └── danger.tsx           # 新：备份 / 卸载（带 confirm）
├── __tests__/
│   └── settings/
│       ├── appearance.test.tsx
│       ├── ai-experience.test.tsx
│       ├── workspace.test.tsx
│       ├── agent.test.tsx
│       └── danger.test.tsx
├── vitest.config.ts             # 新
├── vitest.setup.ts              # 新
```

### 5.2 `agent-client.ts`

```typescript
const AGENT_BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:7777'

export class AgentError extends Error {
  constructor(public status: number, public body: unknown) { super(`Agent ${status}`) }
}

export async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Token 字段留 TODO；issue 03 接入后注入
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new AgentError(res.status, body)
  }
  return res.json() as Promise<T>
}
```

### 5.3 `config-hooks.ts`（TanStack Query）

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Config, WorkspaceInfo, ConfigPatch } from '@ai-devspace/shared'
import { agentFetch } from './agent-client'

const workspaceKey = ['workspace'] as const

export function useWorkspace() {
  return useQuery({
    queryKey: workspaceKey,
    queryFn: () => agentFetch<WorkspaceInfo>('/api/workspace'),
    staleTime: 30_000,
  })
}

export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: ConfigPatch) =>
      agentFetch<{ ok: true; config: Config }>('/api/workspace/config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      qc.setQueryData(workspaceKey, (prev: WorkspaceInfo | undefined) =>
        prev ? { ...prev, config: data.config } : prev
      )
    },
  })
}
```

> **Web 依赖新增**：`@tanstack/react-query`（PRD §9 已规划，本期装上）。`QueryClientProvider` 加到 `(workspace)/layout.tsx`。

### 5.4 Settings 页结构

`settings/page.tsx` 退化为容器，渲染 `<SettingsShell />`：

```tsx
export default function SettingsPage() {
  return <SettingsShell />
}
```

`SettingsShell`：
- 左 240px：5 个 section 入口（外观 / AI 体验 / 工作空间 / Agent 连接 / 危险操作）
- 右 main：当前 active section 内容
- 顶部全局 loading 骨架（`useWorkspace` isLoading 时）
- 全局错误态：内嵌 "加载失败 [重试]"

每个 section 组件：
- props: `{ config: Config; onPatch: (p: ConfigPatch) => Promise<void>; busy: boolean }`
- 用乐观更新：`useUpdateConfig` mutation 的 `onMutate` 里立即更新本地，失败时回滚
- "保存" 按钮：在 mutation pending 时显示 spinner；成功后 1.5s 内显示 ✓ 然后恢复

### 5.5 各 section 字段映射

| Section | 字段 | 类型 | UI 控件 | 回写 path |
|---|---|---|---|---|
| appearance | theme | enum | segmented (3 档) | `{ theme }` |
| appearance | 信息密度（行高/字号） | 占位 | — | （本期不存 config，UI only） |
| ai-experience | typewriterSpeed | enum | segmented (4 档) | `{ typewriterSpeed }` |
| ai-experience | silentWindowSeconds | number | number input (5-300) | `{ silentWindowSeconds }` |
| workspace | workspaceRoot | string | 只读 input + "在文件管理器打开" 按钮 | — |
| workspace | diskUsage | bytes → "1.2 GB" 文本 | 文本 | — |
| agent | 连接状态 | derived | GET /api/health 状态徽章 | — |
| agent | agentEndpoint | string | readonly | — |
| agent | 鉴权 Token | placeholder | masked input + "重置" 占位 | （issue 03 接入） |
| danger | 备份 | button | 下载 backup tar.gz | （后续 issue） |
| danger | 卸载 | button + confirm | 删除 `~/.aidevspace/` | （后续 issue） |

### 5.6 Vitest 配置

```typescript
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
})
```

```typescript
// apps/web/vitest.setup.ts
import '@testing-library/jest-dom/vitest'
```

**devDependencies 新增**：`vitest` `@testing-library/react` `@testing-library/jest-dom` `@testing-library/user-event` `jsdom` `@vitejs/plugin-react` `@tanstack/react-query`

---

## 6. 验收标准

### Agent 端

1. `WorkspaceService.resolveRoot()` 在无 env 时返回 `~/.aidevspace`；有 `AIDEVSPACE_HOME` 时返回其值
2. 全新机器首次启动：5 个子目录全创建、`.gitignore` 写入、`config.yaml` 含 6 个默认 key（`workspaceRoot` 已是绝对路径）
3. 第二次启动：所有目录都标记 `existed`；`.gitignore` 不重写；`config.yaml` 用户值保留，只补缺
4. `GET /api/workspace` 返回 200 + 完整 `WorkspaceInfo`（含真实磁盘字节数）
5. `PATCH /api/workspace/config` 接受部分 patch，返回合并后的全量 config；非法 patch 返 400 + ZodIssue
6. 写盘中途崩溃（模拟 kill -9）后下次启动仍能恢复（`.tmp` 文件可忽略）
7. 跨平台：CI 在 macOS / Linux / Windows 都通过

### Web 端

8. Settings 页打开后 1.5s 内出现 config 内容（staleTime 内缓存命中则即时）
9. 改主题 → 立即回写 `config.yaml`（PATCH 成功）→ 整页 theme 字段反映新值
10. 打字机速度 4 档切换 / 静默窗口数值改动 都能保存成功
11. 「在文件管理器打开」按钮调 agent 占位端点（本期 PATCH `/api/workspace/open` 返回 `{ ok: true }`，**纯占位**）
12. 「卸载」按钮弹 confirm，确认后调 agent `POST /api/workspace/uninstall` 占位端点 → 显示「卸载功能开发中」Toast
13. agent 不可达时 settings 页显示"加载失败 [重试]" 内嵌错误

---

## 7. 风险与权衡

| 风险 | 缓解 |
|---|---|
| YAML 注释 / 顺序丢失 | 用 `yaml.Document` 保留 AST，避免 `parse(stringify())` 损失 |
| 大 workspace 磁盘扫描慢 | 50k 文件兜底走 `du -sk`；当前阶段不需要 |
| 进程并发写同一 config | 单进程内同步；后续 issue 用 `proper-lockfile` |
| 根路径切换后旧路径残留 | 本期不支持；issue 后续再做 workspace 迁移 |
| Web 整页接入范围广 | 5 个 section 测试独立，单测 + 集成测覆盖到 |
| Vitest + Next.js 14 兼容性 | 用 `@vitejs/plugin-react` 而非 next/jest；不动 next.config |
| agent-client 鉴权缺失 | 本期允许 localhost:3333 origin；issue 03 加 token |

---

## 8. 不在范围（确认剔除）

- 真实鉴权 token 注入 → issue 03
- 多 Agent Provider UI 切换 → 后续 P2
- Workspace 迁移 / 多 workspace → 后续
- Snapshot 机制实际功能 → 后续（ADR-0009）
- 多用户 / 团队协作 → MVP 不做
- Web 端代码编辑 / 拖拽编排 / 移动端 → MVP 不做

---

## 9. /tdd 红绿切片（顺序）

每个 slice 都是 red-green：先写失败测试，再写最小实现，再 refactor。

1. **`packages/shared/src/config-defaults.ts`** — `DEFAULT_CONFIG` 常量；Zod schema
2. **`WorkspaceService.resolveRoot`** — 测试 env 优先、默认 `~/.aidevspace`
3. **`WorkspaceService.initWorkspace` 目录创建** — 5 个子目录创建/存在检测
4. **`WorkspaceService.initWorkspace` .gitignore** — 缺失写入、存在保留
5. **`WorkspaceService.initWorkspace` config.yaml 写默认** — 全新场景
6. **`WorkspaceService.initWorkspace` 补缺不覆盖** — 已存在场景
7. **`WorkspaceService.initWorkspace` workspaceRoot 注入** — config.yaml 写完后注入实际路径
8. **`WorkspaceService.getWorkspaceInfo`** — 返回完整结构
9. **`WorkspaceService.updateConfig` 深合并** — 嵌套 key 合并
10. **`WorkspaceService` 写盘原子性** — `.tmp` + rename
11. **`WorkspaceService` 磁盘占用** — 递归 + 50k 兜底
12. **Agent 路由 `GET /api/workspace`** — 集成测试
13. **Agent 路由 `PATCH /api/workspace/config`** — 校验 + 成功 + 失败
14. **`server.ts` boot init** — mock fs 验证启动时调用
15. **Web `agent-client.ts`** — fetch 包装 + AgentError
16. **Web `useWorkspace` hook** — TanStack Query 集成
17. **Web `useUpdateConfig` hook** — mutation + 乐观更新
18. **Web SettingsShell** — 容器 + loading/error
19. **Web appearance section** — theme segmented
20. **Web ai-experience section** — typewriter + silent window
21. **Web workspace section** — 只读 + "在文件管理器打开" 占位
22. **Web agent section** — 健康徽章 + token 占位
23. **Web danger section** — confirm 弹窗 + 占位 Toast
24. **Web settings 集成** — 5 个 section 拼到 Shell，端到端走一遍

---

## 10. 实施依赖与产物文件清单

### 新增依赖

`apps/agent/package.json`：
- `yaml` ^2.6.0
- （`@fastify/sse` 留给后续 SSE 路由，本期不装）

`apps/web/package.json`：
- 依赖：`@tanstack/react-query` ^5.59.0
- devDeps：`vitest` ^2.1.0 `@testing-library/react` ^16.0.0 `@testing-library/jest-dom` ^6.6.0 `@testing-library/user-event` ^14.5.0 `jsdom` ^25.0.0 `@vitejs/plugin-react` ^4.3.0

`packages/shared/package.json`：
- 依赖：`zod` ^3.23.0
- devDeps：`vitest` ^2.1.0（保证 config-defaults 单测能跑）

### 新增文件

```text
packages/shared/src/
├── config-defaults.ts
├── workspace.ts
├── index.ts                        # 改：导出新模块
└── __tests__/
    ├── config-defaults.test.ts
    └── workspace-schema.test.ts

apps/agent/src/
├── services/
│   └── WorkspaceService.ts
├── routes/
│   └── workspace.ts
└── __tests__/
    ├── workspace-service.test.ts
    └── workspace-route.test.ts

apps/web/src/
├── lib/
│   ├── agent-client.ts
│   └── config-hooks.ts
├── app/(workspace)/settings/
│   ├── settings-shell.tsx
│   └── sections/
│       ├── appearance.tsx
│       ├── ai-experience.tsx
│       ├── workspace.tsx
│       ├── agent.tsx
│       └── danger.tsx
├── __tests__/settings/
│   ├── appearance.test.tsx
│   ├── ai-experience.test.tsx
│   ├── workspace.test.tsx
│   ├── agent.test.tsx
│   └── danger.test.tsx
├── vitest.config.ts
└── vitest.setup.ts
```

### 修改文件

- `apps/agent/src/server.ts` — boot 时 init，register workspace routes
- `apps/web/src/app/(workspace)/layout.tsx` — 加 QueryClientProvider
- `apps/web/src/app/(workspace)/settings/page.tsx` — 改为 `<SettingsShell />` 容器
- `packages/shared/src/index.ts` — 导出新模块

---

## 11. Comments
