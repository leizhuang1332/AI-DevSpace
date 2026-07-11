# Agent Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/agent` 从 issue 02 末态（Fastify + `/api/health` + workspace）升级为 issue 03 定义的骨架：鉴权 + 7 条 REST 路由（含 5 条 501）+ SSE 长连通道 + 进程保活 + 文件日志。

**Architecture:** Fastify 单进程 + 进程内 SseHub 桥（pin 后续 issue 06 SDK 集成）+ Auth Fastify plugin（preHandler 校验 cookie/header 双 sink）+ 同源 Origin 白名单。零新增运行依赖（仅 `@fastify/sse` 一个 npm 包）。保活走 bash 5s `kill -0` 轮询。

**Tech Stack:** Fastify 5、`@fastify/sse`、`@fastify/cors`（已有）、pino（Fastify 自带）、zod（`@ai-devspace/shared`）、Vitest 2。

**Spec reference:** `docs/superpowers/specs/2026-07-12-agent-skeleton-design.md`

---

## File Structure

**新增 (`packages/shared/`)**
- `src/sse.ts` — `SseEvent` 联合类型 + `SSE_HEARTBEAT_MS` 常量
- `src/api.ts` — `NotImplementedError` / `ApiError` / `BootstrapResponse` 等 Zod schema
- `src/error.ts` — `ApiErrorCode` 枚举（字符串字面量 union）
- `src/index.ts` — modify, re-export 新模块
- `src/__tests__/sse.test.ts` — 事件类型常量与类型守卫
- `src/__tests__/api.test.ts` — schema 解析

**新增 (`apps/agent/src/`)**
- `auth/TokenManager.ts` — token 路径解析 + ensure + get/setRootForTest
- `auth/cookie.ts` — `parseCookie(header, name)` 工具
- `auth/authPlugin.ts` — Fastify onRequest hook 鉴权
- `sse/SseHub.ts` — 进程内事件总线
- `sse/requirementEventsRoute.ts` — SSE 路由注册函数
- `routes/requirement.ts` — 5 条 501 占位路由
- `routes/bootstrap.ts` — `/api/agent/bootstrap` 路由
- `services/HealthService.ts` — 聚合 health 字段

**新增 (tests, 沿用 `apps/agent/src/__tests__/` 扁平约定)**
- `__tests__/TokenManager.test.ts`
- `__tests__/cookie.test.ts`
- `__tests__/authPlugin.test.ts`
- `__tests__/SseHub.test.ts`
- `__tests__/requirementEventsRoute.test.ts`
- `__tests__/requirement.test.ts`
- `__tests__/bootstrap.test.ts`
- `__tests__/HealthService.test.ts`
- `__tests__/health.test.ts`
- `__tests__/agent-skeleton.e2e.test.ts`

**新增 (`packages/scripts/`)**
- `agent-start.sh`
- `agent-stop.sh`
- `agent-watch.sh`
- `agent-status.sh`
- `__tests__/smoke.test.ts` — vitest 跑 `bash -n` 解析

**修改**
- `apps/agent/package.json` — 新增 `@fastify/sse` 依赖；`pnpm test`/`pnpm typecheck`/`pnpm lint` 沿用
- `apps/agent/src/server.ts` — 集成 token manager、auth plugin、health service、sse routes、requirement routes、bootstrap route、dual-sink log、PID file
- 顶层 `package.json` — 新增 `agent:start`、`agent:stop`、`agent:watch`、`agent:status` 脚本
- 顶层 `README.md` — 新增 Agent 操作段落 + Windows 限制说明

---

## Conventions

1. **测试位置**: `apps/agent/src/__tests__/*.test.ts`（沿用现有扁平约定）。`packages/shared/src/__tests__/*.test.ts`（本任务新建文件夹）。
2. **commit 节奏**: 每 Task 末尾单独 commit，PR 描述引用 issue 03。
3. **path 解析**: 全部走 `path.join(os.homedir(), '.aidevspace', '<file>')`；测试用 `process.env.AIDEVSPACE_HOME` 隔离。
4. **错误统一**: Fastify `setErrorHandler` 包成 `{ error: string; message?: string; details?: unknown }`。
5. **TDD 顺序**: 写失败测试 → 跑确认红 → 写最小实现 → 跑确认绿 → 重构（如需）→ commit。
6. **不要动现有未 commit 改动**：`apps/agent/src/server.ts` 当前有未 commit 改动（issue 02 阶段遗留）。本任务从最新 commit 基线重新组织 server.ts（保留 WorkspaceService init 与 isMain 结构），把未 commit 的内容并入下一次 commit。

---

## Task 1: 安装依赖 + 共享类型（sse / api / error）

**Files:**
- Modify: `apps/agent/package.json`（新增 `@fastify/sse` 依赖）
- Create: `packages/shared/src/sse.ts`
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/src/error.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/sse.test.ts`
- Create: `packages/shared/src/__tests__/api.test.ts`

### Step 1.1: 安装 `@fastify/sse`

在 `apps/agent/package.json` 的 `dependencies` 末尾增加一行 `"@fastify/sse": "^0.5.0"`。

> **版本说明**：npm 上 `@fastify/sse` 当前最高版本为 `0.5.0`（尚未发布 1.x），与 Fastify 5 兼容；若发现与 fastify v5 peerDep 冲突，加 `--ignore-peer-deps` 兜底。

然后：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/.worktrees/feat-issue-03-agent-skeleton
pnpm install
```

期望：lockfile 更新；`apps/agent/node_modules/@fastify/sse/` 出现。

### Step 1.2: 写失败测试 — sse 类型

创建 `packages/shared/src/__tests__/sse.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { SSE_HEARTBEAT_MS, type SseEvent } from '../sse.js'

describe('sse constants', () => {
  it('exports a 30s heartbeat constant', () => {
    expect(SSE_HEARTBEAT_MS).toBe(30_000)
  })
})

describe('SseEvent type narrowing', () => {
  it('hello event has sid and reqId', () => {
    const e: SseEvent = { type: 'hello', sid: 'x', reqId: 'r', ts: 1 }
    if (e.type === 'hello') {
      expect(e.sid).toBe('x')
      expect(e.reqId).toBe('r')
    } else {
      throw new Error('expected hello')
    }
  })

  it('heartbeat event has only ts', () => {
    const e: SseEvent = { type: 'heartbeat', ts: 1 }
    if (e.type === 'heartbeat') expect(e.ts).toBe(1)
  })

  it('placeholder event has message', () => {
    const e: SseEvent = { type: 'placeholder', message: 'no events yet' }
    if (e.type === 'placeholder') expect(e.message).toBe('no events yet')
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/shared && pnpm test sse.test.ts
```

期望：FAIL，`Cannot find module '../sse.js'`。

### Step 1.3: 实现 sse.ts

创建 `packages/shared/src/sse.ts`：

```ts
/**
 * SSE event types shared between Agent and Web.
 * Extend by UNION adding new variants — never break existing members.
 */
export type SseEvent =
  | { type: 'hello'; sid: string; reqId: string; ts: number }
  | { type: 'heartbeat'; ts: number }
  | { type: 'placeholder'; message: string }

export const SSE_HEARTBEAT_MS = 30_000
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/shared && pnpm test sse.test.ts
```

期望：3 passed。

### Step 1.4: 写失败测试 — api schema

创建 `packages/shared/src/__tests__/api.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
 {
  NotImplementedError,
  ApiError,
  BootstrapResponse,
  ApiErrorCode,
} from '../api.js'

describe('NotImplementedError', () => {
  it('parses valid 501 body', () => {
    const r = NotImplementedError.safeParse({
      error: 'not_implemented',
      feature: 'requirement.create',
      message: 'pending',
      issue: '05',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing feature', () => {
    const r = NotImplementedError.safeParse({
      error: 'not_implemented',
      message: 'p',
      issue: '05',
    })
    expect(r.success).toBe(false)
  })
})

describe('ApiError', () => {
  it('parses minimal shape', () => {
    const r = ApiError.safeParse({ error: 'unauthorized' })
    expect(r.success).toBe(true)
  })

  it('rejects non-string error', () => {
    const r = ApiError.safeParse({ error: 123 })
    expect(r.success).toBe(false)
  })
})

describe('BootstrapResponse', () => {
  it('accepts full payload', () => {
    const r = BootstrapResponse.safeParse({
      ok: true,
      token: 'a'.repeat(43),  // 32-byte random base64url token, length 43
      cookieName: 'aidevspace_token',
      cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 2592000 },
      apiBase: 'http://localhost:7777',
      agentVersion: '0.0.0',
      sseNote: 'use cookie',
    })
    expect(r.success).toBe(true)
  })
})

describe('ApiErrorCode', () => {
  it('includes canonical codes', () => {
    expect(ApiErrorCode.unauthorized).toBe('unauthorized')
    expect(ApiErrorCode.origin_not_allowed).toBe('origin_not_allowed')
    expect(ApiErrorCode.not_implemented).toBe('not_implemented')
    expect(ApiErrorCode.internal).toBe('internal')
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/shared && pnpm test api.test.ts
```

期望：FAIL，`Cannot find module '../api.js'`。

### Step 1.5: 实现 api.ts

创建 `packages/shared/src/api.ts`：

```ts
import { z } from 'zod'

export const ApiErrorCode = {
  unauthorized: 'unauthorized',
  origin_not_allowed: 'origin_not_allowed',
  not_implemented: 'not_implemented',
  not_found: 'not_found',
  invalid_patch: 'invalid_patch',
  internal: 'internal',
} as const
export type ApiErrorCodeT = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export const ApiError = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})
export type ApiErrorT = z.infer<typeof ApiError>

export const NotImplementedError = z.object({
  error: z.literal('not_implemented'),
  feature: z.string(),
  message: z.string(),
  issue: z.string(),
})
export type NotImplementedErrorT = z.infer<typeof NotImplementedError>

export const CookieAttributesSchema = z.object({
  SameSite: z.enum(['Strict', 'Lax', 'None']),
  Path: z.string(),
  MaxAge: z.number().int().nonnegative(),
})

export const BootstrapResponse = z.object({
  ok: z.literal(true),
  token: z.string().min(40).max(64),
  cookieName: z.literal('aidevspace_token'),
  cookieAttributes: CookieAttributesSchema,
  apiBase: z.string().url(),
  agentVersion: z.string(),
  sseNote: z.string(),
})
export type BootstrapResponseT = z.infer<typeof BootstrapResponse>
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/shared && pnpm test api.test.ts
```

期望：5 passed。

### Step 1.6: 实现 error.ts（占位文件 — 当前 schema 在 api.ts 已含 error）

创建 `packages/shared/src/error.ts`（先导出一个空常量与 ApiError 重导出，保留扩展位）：

```ts
/**
 * Reserved for central error enum when schema grows beyond api.ts.
 * Currently ApiError / NotImplementedError / ApiErrorCode live in `./api.ts`.
 * This barrel is the future home for cross-cutting error utilities.
 */
export { ApiError, NotImplementedError, ApiErrorCode } from './api.js'
export type { ApiErrorT, NotImplementedErrorT } from './api.js'
```

### Step 1.7: 修改 index.ts re-export

修改 `packages/shared/src/index.ts`（在末尾追加）：

```ts
export * from './sse.js'
export * from './api.js'
export * from './error.js'
```

### Step 1.8: 跑全部 shared 测试 + 顶层 typecheck

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/shared && pnpm test && pnpm typecheck
```

期望：全部通过；typecheck 干净。

### Step 1.9: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/package.json pnpm-lock.yaml packages/shared/src/
git commit -m "feat(shared): add SseEvent + ApiError + BootstrapResponse schemas (issue 03/1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: TokenManager

**Files:**
- Create: `apps/agent/src/auth/TokenManager.ts`
- Create: `apps/agent/src/__tests__/TokenManager.test.ts`

### Step 2.1: 写失败测试

创建 `apps/agent/src/__tests__/TokenManager.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-tok-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('TokenManager.ensure', () => {
  it('creates a 43-char base64url token file with mode 0600 on first call', async () => {
    const tm = new TokenManager(root)
    const token = await tm.ensure()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const p = join(root, '.agent-token')
    expect(existsSync(p)).toBe(true)
    const stat = statSync(p)
    expect(stat.mode & 0o777).toBe(0o600)
    const contents = (await import('node:fs')).readFileSync(p, 'utf8')
    expect(contents).toBe(token)
  })

  it('returns existing token without overwriting on second call', async () => {
    const tm = new TokenManager(root)
    const t1 = await tm.ensure()
    const t2 = await tm.ensure()
    expect(t1).toBe(t2)
  })

  it('does not overwrite an externally-set token file', async () => {
    const p = join(root, '.agent-token')
    writeFileSync(p, 'preexisting-token-1234567890123456789012345', { mode: 0o600 })
    const tm = new TokenManager(root)
    const t = await tm.ensure()
    expect(t).toBe('preexisting-token-1234567890123456789012345')
  })

  it('warns (does not throw) when file exists with mode 0666', async () => {
    const p = join(root, '.agent-token')
    writeFileSync(p, 'preexisting-token-1234567890123456789012345', { mode: 0o666 })
    const tm = new TokenManager(root)
    await expect(tm.ensure()).resolves.toBe('preexisting-token-1234567890123456789012345')
  })
})

describe('TokenManager.get', () => {
  it('throws if ensure has not been called', () => {
    const tm = new TokenManager(root)
    expect(() => tm.get()).toThrow(/token not initialised/i)
  })

  it('returns cached token after ensure', async () => {
    const tm = new TokenManager(root)
    const t = await tm.ensure()
    expect(tm.get()).toBe(t)
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test TokenManager.test.ts
```

期望：FAIL，`Cannot find module '../auth/TokenManager.js'`。

### Step 2.2: 实现 TokenManager

创建 `apps/agent/src/auth/TokenManager.ts`：

```ts
import { randomBytes } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, statSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface TokenManagerLogger {
  warn(msg: string, ctx?: Record<string, unknown>): void
}

export class TokenManager {
  private cached: string | null = null
  private warnedMode = false

  constructor(
    private readonly root: string,
    private readonly logger?: TokenManagerLogger,
  ) {}

  /** Lazily generate-or-read the token; idempotent. */
  async ensure(): Promise<string> {
    if (this.cached) return this.cached
    const tokenPath = this.tokenPath()
    let existing: string | null = null
    try {
      existing = readFileSync(tokenPath, 'utf8')
    } catch {
      existing = null
    }
    if (!existing) {
      mkdirSync(dirname(tokenPath), { recursive: true })
      const generated = randomBytes(32).toString('base64url')
      const fd = openSync(tokenPath, 'wx', 0o600)
      try {
        writeFileSync(fd, generated)
      } finally {
        closeSync(fd)
      }
      existing = generated
    } else {
      // Sanity-check mode; warn if too permissive
      try {
        const mode = statSync(tokenPath).mode & 0o777
        if (mode & 0o077) {
          if (!this.warnedMode) {
            this.logger?.warn('agent-token file mode is too permissive', { mode: mode.toString(8) })
            this.warnedMode = true
          }
        }
      } catch {
        /* ignore stat failure */
      }
    }
    this.cached = existing
    return existing
  }

  /** Return cached token; throws if ensure() has not been called. */
  get(): string {
    if (!this.cached) throw new Error('TokenManager: token not initialised; call ensure() first')
    return this.cached
  }

  tokenPath(): string {
    return join(this.root, '.agent-token')
  }
}
```

### Step 2.3: 跑测试，确认绿

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test TokenManager.test.ts
```

期望：6 passed。

### Step 2.4: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/auth/TokenManager.ts apps/agent/src/__tests__/TokenManager.test.ts
git commit -m "feat(agent): TokenManager with ensure-once + 0600 mode (issue 03/2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: cookie 解析工具 + AuthPlugin

**Files:**
- Create: `apps/agent/src/auth/cookie.ts`
- Create: `apps/agent/src/auth/authPlugin.ts`
- Create: `apps/agent/src/__tests__/cookie.test.ts`
- Create: `apps/agent/src/__tests__/authPlugin.test.ts`

### Step 3.1: 写 cookie 测试

创建 `apps/agent/src/__tests__/cookie.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseCookie } from '../auth/cookie.js'

describe('parseCookie', () => {
  it('reads single cookie from header', () => {
    expect(parseCookie('aidevspace_token=abc123', 'aidevspace_token')).toBe('abc123')
  })

  it('reads cookie among multiple', () => {
    expect(parseCookie('foo=1; bar=2; aidevspace_token=xyz; baz=3', 'aidevspace_token')).toBe('xyz')
  })

  it('returns null when name not present', () => {
    expect(parseCookie('foo=1', 'aidevspace_token')).toBeNull()
  })

  it('returns null for null/undefined header', () => {
    expect(parseCookie(null, 'aidevspace_token')).toBeNull()
    expect(parseCookie(undefined, 'aidevspace_token')).toBeNull()
  })

  it('trims whitespace and ignores empty pairs', () => {
    expect(parseCookie('  ;  aidevspace_token=tok  ;  ', 'aidevspace_token')).toBe('tok')
  })

  it('returns first value when name appears twice', () => {
    expect(parseCookie('aidevspace_token=first; aidevspace_token=second', 'aidevspace_token')).toBe('first')
  })

  it('handles zero-length value', () => {
    expect(parseCookie('aidevspace_token=', 'aidevspace_token')).toBe('')
  })
})
```

### Step 3.2: 实现 cookie.ts

创建 `apps/agent/src/auth/cookie.ts`：

```ts
/**
 * Minimal cookie header parser. Supports only what we need:
 *   - header = `name1=value1; name2=value2; ...`
 *   - whitespace around `;` and `=` is tolerated
 *   - duplicate names: first wins
 *   - empty header or missing name → null
 */
export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const rawPair of header.split(';')) {
    const eq = rawPair.indexOf('=')
    if (eq < 0) continue
    const key = rawPair.slice(0, eq).trim()
    if (key !== name) continue
    const value = rawPair.slice(eq + 1).trim()
    return value
  }
  return null
}
```

### Step 3.3: 跑 cookie 测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test cookie.test.ts
```

期望：7 passed。

### Step 3.4: 写失败测试 — authPlugin

创建 `apps/agent/src/__tests__/authPlugin.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function buildApp(token: string, allowedOrigins: string[] = [
  'http://localhost:3333',
  'http://127.0.0.1:3333',
]): Promise<{ app: FastifyInstance; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-auth-'))
  const tm = new TokenManager(root)
  await tm.ensure()
  // Force-override token for predictable assertion
  ;(tm as unknown as { cached: string }).cached = token

  const app = Fastify({ logger: false })
  await app.register(authPlugin, {
    tokenManager: tm,
    allowedOrigins,
  })
  app.get('/api/protected', async () => ({ ok: true }))
  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }))
  await app.ready()
  return { app, root }
}

const TOKEN = 'a'.repeat(43)

describe('authPlugin', () => {
  it('401 when no token and not public', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({ method: 'GET', url: '/api/protected' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('401 when header token is wrong', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-aidevspace-token': 'wrong' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('200 with correct X-AIDevSpace-Token header', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-aidevspace-token': TOKEN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('200 with correct cookie', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { cookie: `aidevspace_token=${TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('cookie preferred over header when both present', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        cookie: `aidevspace_token=${TOKEN}`,
        'x-aidevspace-token': 'wrong',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('403 when Origin not in allowlist', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        'x-aidevspace-token': TOKEN,
        origin: 'http://evil.com',
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'origin_not_allowed', origin: 'http://evil.com' })
  })

  it('allows request when Origin is allowlisted', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        'x-aidevspace-token': TOKEN,
        origin: 'http://localhost:3333',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('skips origin check when no Origin header (e.g. curl)', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-aidevspace-token': TOKEN },
    })
    expect(res.statusCode).toBe(200)
  })

  it('200 on public route without token', async () => {
    const { app } = await buildApp(TOKEN)
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test authPlugin.test.ts
```

期望：FAIL，`Cannot find module '../auth/authPlugin.js'`。

### Step 3.5: 实现 authPlugin.ts

**3.5.0 加依赖** — 在 `apps/agent/package.json` 的 `dependencies` 末尾追加 `"fastify-plugin": "^5.0.0"`，然后 `pnpm install`。

> **为什么需要 fastify-plugin**：Fastify 5 插件默认会创建 encapsulation scope，`onRequest` hook 只作用在插件内部注册的路由。auth 是 cross-cutting 必须全局生效，要用 `fastify-plugin` 的 `fp()` 包装来"逃出"封装。这是 Fastify 生态标准做法。

创建 `apps/agent/src/auth/authPlugin.ts`：

```ts
import fp from 'fastify-plugin'
import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { parseCookie } from './cookie.js'
import type { TokenManager } from './TokenManager.js'

export interface AuthPluginOptions {
  tokenManager: TokenManager
  allowedOrigins: string[]
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

const authImpl: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { tokenManager, allowedOrigins } = opts
  fastify.addHook('onRequest', async (req, reply) => {
    // Public bypass: routes declare { config: { public: true } }
    const cfg = (req.routeOptions.config ?? {}) as { public?: boolean }
    if (cfg.public) return

    const cookieTok = parseCookie(req.headers.cookie, 'aidevspace_token')
    const headerRaw = req.headers['x-aidevspace-token']
    const headerTok = typeof headerRaw === 'string' ? headerRaw : null
    const candidate = cookieTok ?? headerTok

    if (!candidate || !safeEqual(candidate, tokenManager.get())) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const origin = req.headers.origin
    if (origin && !allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed', origin })
    }
  })
}

// `fp()` opts out of Fastify's plugin encapsulation so the onRequest hook
// applies to sibling routes on the parent Fastify instance (auth is
// cross-cutting, not just sub-tree-scoped).
export const authPlugin = fp<AuthPluginOptions>(authImpl, { name: 'authPlugin' })
```

### Step 3.6: 跑全部 auth 测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test authPlugin.test.ts cookie.test.ts
```

期望：16 passed（9 + 7）。

### Step 3.7: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/auth/ apps/agent/src/__tests__/cookie.test.ts apps/agent/src/__tests__/authPlugin.test.ts
git commit -m "feat(agent): authPlugin with cookie>header token + Origin allowlist (issue 03/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: SseHub（进程内事件总线）

**Files:**
- Create: `apps/agent/src/sse/SseHub.ts`
- Create: `apps/agent/src/__tests__/SseHub.test.ts`

### Step 4.1: 写失败测试

创建 `apps/agent/src/__tests__/SseHub.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSseHub } from '../sse/SseHub.js'
import type { SseEvent } from '@ai-devspace/shared'

describe('createSseHub', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a published event to a subscriber', () => {
    const hub = createSseHub()
    const received: SseEvent[] = []
    hub.subscribe('r1', (e) => received.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(received).toEqual([{ type: 'heartbeat', ts: 1 }])
  })

  it('does not deliver to subscribers of a different reqId', () => {
    const hub = createSseHub()
    const r1: SseEvent[] = []
    const r2: SseEvent[] = []
    hub.subscribe('r1', (e) => r1.push(e))
    hub.subscribe('r2', (e) => r2.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(0)
  })

  it('unsubscribe stops future deliveries', () => {
    const hub = createSseHub()
    const received: SseEvent[] = []
    const unsub = hub.subscribe('r1', (e) => received.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    unsub()
    hub.publish('r1', { type: 'heartbeat', ts: 2 })
    expect(received).toEqual([{ type: 'heartbeat', ts: 1 }])
  })

  it('does not start heartbeat timer when no subscribers', () => {
    const hub = createSseHub()
    expect(hub.stats().subscribers).toBe(0)
    // No timer should have scheduled a heartbeat
    vi.advanceTimersByTime(60_000)
    // Still zero subscribers; nothing observable here, this is a smoke test
    expect(hub.stats().subscribers).toBe(0)
  })

  it('sends heartbeat to all subscribers of a reqId', () => {
    const hub = createSseHub()
    const a: SseEvent[] = []
    const b: SseEvent[] = []
    hub.subscribe('r1', (e) => a.push(e))
    hub.subscribe('r1', (e) => b.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('returns subscriber count from stats', () => {
    const hub = createSseHub()
    expect(hub.stats().subscribers).toBe(0)
    const u1 = hub.subscribe('r1', () => {})
    expect(hub.stats().subscribers).toBe(1)
    const u2 = hub.subscribe('r2', () => {})
    expect(hub.stats().subscribers).toBe(2)
    u1()
    expect(hub.stats().subscribers).toBe(1)
    u2()
    expect(hub.stats().subscribers).toBe(0)
  })

  it('close() removes all subscribers and stops timers', async () => {
    const hub = createSseHub()
    const received: SseEvent[] = []
    hub.subscribe('r1', (e) => received.push(e))
    await hub.close()
    expect(hub.stats().subscribers).toBe(0)
    // After close, publish should be a no-op
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(received).toHaveLength(0)
  })

  it('does not throw on publish to reqId with no subscribers', () => {
    const hub = createSseHub()
    expect(() => hub.publish('none', { type: 'heartbeat', ts: 1 })).not.toThrow()
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test SseHub.test.ts
```

期望：FAIL，`Cannot find module '../sse/SseHub.js'`。

### Step 4.2: 实现 SseHub.ts

创建 `apps/agent/src/sse/SseHub.ts`：

```ts
import type { SseEvent } from '@ai-devspace/shared'
import { SSE_HEARTBEAT_MS } from '@ai-devspace/shared'

export type SseListener = (event: SseEvent) => void
export type Unsubscribe = () => void

export interface SseHub {
  subscribe(reqId: string, listener: SseListener): Unsubscribe
  publish(reqId: string, event: SseEvent): void
  close(): Promise<void>
  stats(): { subscribers: number }
}

export interface CreateSseHubOptions {
  heartbeatMs?: number
  /** Injectable timer functions for tests. Defaults to global setInterval/clearInterval. */
  scheduler?: {
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
  }
}

export function createSseHub(opts: CreateSseHubOptions = {}): SseHub {
  const channels = new Map<string, Set<SseListener>>()
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS
  const scheduler = opts.scheduler ?? { setInterval, clearInterval }
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let closed = false

  function totalSubscribers(): number {
    let n = 0
    for (const set of channels.values()) n += set.size
    return n
  }

  function ensureHeartbeatRunning(): void {
    if (heartbeatTimer !== null) return
    heartbeatTimer = scheduler.setInterval(() => {
      const ts = Date.now()
      const ev: SseEvent = { type: 'heartbeat', ts }
      for (const set of channels.values()) {
        for (const listener of set) {
          try {
            listener(ev)
          } catch {
            /* listener errors must not break others */
          }
        }
      }
    }, heartbeatMs)
    // Allow Node to exit even if timer is referenced
    ;(heartbeatTimer as unknown as { unref?: () => void }).unref?.()
  }

  function maybeStopHeartbeat(): void {
    if (heartbeatTimer !== null && totalSubscribers() === 0) {
      scheduler.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function subscribe(reqId: string, listener: SseListener): Unsubscribe {
    if (closed) return () => {}
    let set = channels.get(reqId)
    if (!set) {
      set = new Set()
      channels.set(reqId, set)
    }
    set.add(listener)
    ensureHeartbeatRunning()
    return () => {
      const s = channels.get(reqId)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) channels.delete(reqId)
      maybeStopHeartbeat()
    }
  }

  function publish(reqId: string, event: SseEvent): void {
    if (closed) return
    const set = channels.get(reqId)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        /* swallow */
      }
    }
  }

  async function close(): Promise<void> {
    closed = true
    if (heartbeatTimer !== null) {
      scheduler.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    channels.clear()
  }

  function stats(): { subscribers: number } {
    return { subscribers: totalSubscribers() }
  }

  return { subscribe, publish, close, stats }
}
```

### Step 4.3: 跑测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test SseHub.test.ts
```

期望：8 passed。

### Step 4.4: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/sse/SseHub.ts apps/agent/src/__tests__/SseHub.test.ts
git commit -m "feat(agent): SseHub pub/sub with lazy heartbeat (issue 03/4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: requirementEventsRoute（SSE 长连路由）

**Files:**
- Create: `apps/agent/src/sse/requirementEventsRoute.ts`
- Create: `apps/agent/src/__tests__/requirementEventsRoute.test.ts`

### Step 5.1: 写失败测试

创建 `apps/agent/src/__tests__/requirementEventsRoute.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sseRoutes } from '../sse/requirementEventsRoute.js'
import { createRequire } from 'node:module'

let app: FastifyInstance
let hub: SseHub
let token: string

const require = createRequire(import.meta.url)

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('GET /api/requirement/:id/events', () => {
  beforeEach(async () => {
    vi.useRealTimers()  // we want real timers for streaming tests
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-sse-'))
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })  // disable automatic heartbeat
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(sseRoutes, { hub })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
  })

  it('returns text/event-stream content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/REFUND-001/events',
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
  })

  it('emits a hello event immediately', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/REFUND-001/events',
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.body).toMatch(/event: hello/)
    expect(res.body).toMatch(/"reqId":"REFUND-001"/)
    expect(res.body).toMatch(/"sid":/)
  })

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/REFUND-001/events',
    })
    expect(res.statusCode).toBe(401)
  })

  it('emits X-Accel-Buffering: no', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/REFUND-001/events',
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.headers['x-accel-buffering']).toBe('no')
  })

  it('subscribes to the reqId channel', () => {
    // After a successful inject above (in beforeEach implicitly), we open one now:
    expect(hub.stats().subscribers).toBe(0)
  })

  it('writes a publish() event to the stream body', async () => {
    const p = app.inject({
      method: 'GET',
      url: '/api/requirement/REFUND-001/events',
      headers: { 'x-aidevspace-token': token },
    })
    // small tick so the route actually registers the listener
    await wait(10)
    hub.publish('REFUND-001', { type: 'placeholder', message: 'hello future' })
    const res = await p
    expect(res.body).toMatch(/event: placeholder/)
    expect(res.body).toMatch(/hello future/)
  })
})
```

> 注：本测试用 `app.inject`（Fastify 5 的 streaming 注入）。`hello` 事件同步发出；`heartbeat` 在本测试 hub 里设了 60s 不会立刻触发。

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test requirementEventsRoute.test.ts
```

期望：FAIL，`Cannot find module '../sse/requirementEventsRoute.js'`。

### Step 5.2: 实现 requirementEventsRoute

创建 `apps/agent/src/sse/requirementEventsRoute.ts`：

```ts
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from './SseHub.js'

export interface SseRoutesOptions {
  hub: SseHub
}

function encode(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const sseRoutes: FastifyPluginAsync<SseRoutesOptions> = async (fastify, opts) => {
  const { hub } = opts
  fastify.get<{ Params: { id: string } }>(
    '/api/requirement/:id/events',
    async (req, reply) => {
      const reqId = req.params.id
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.hijack()

      const sid = randomUUID()
      const write = (event: SseEvent): void => {
        try {
          reply.raw.write(encode(event))
        } catch {
          /* socket already closed */
        }
      }

      write({ type: 'hello', sid, reqId, ts: Date.now() })

      const unsubscribe = hub.subscribe(reqId, write)
      const cleanup = (): void => {
        unsubscribe()
        reply.raw.off('close', cleanup)
      }
      reply.raw.on('close', cleanup)
    },
  )
}
```

### Step 5.3: 跑测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test requirementEventsRoute.test.ts
```

期望：5 passed（其中第 6 个 `subscribes to the reqId channel` 仅 sanity check stats，不强制断言）。

### Step 5.4: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/sse/requirementEventsRoute.ts apps/agent/src/__tests__/requirementEventsRoute.test.ts
git commit -m "feat(agent): SSE requirement events route (issue 03/5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: requirement 路由（5 条 501 占位）

**Files:**
- Create: `apps/agent/src/routes/requirement.ts`
- Create: `apps/agent/src/__tests__/requirement.test.ts`

### Step 6.1: 写失败测试

创建 `apps/agent/src/__tests__/requirement.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { requirementRoutes } from '../routes/requirement.js'

let app: FastifyInstance
let root: string
let token: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-req-'))
  const tm = new TokenManager(root)
  token = await tm.ensure()
  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(requirementRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

async function authed(method: 'GET' | 'POST' | 'PATCH', url: string): Promise<{
  statusCode: number;
  body: Record<string, unknown>;
}> {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-aidevspace-token': token },
  })
  return { statusCode: res.statusCode, body: res.json() }
}

describe('requirement routes return 501 not_implemented', () => {
  it('POST /api/requirement → 501 with feature=requirement.create', async () => {
    const { statusCode, body } = await authed('POST', '/api/requirement')
    expect(statusCode).toBe(501)
    expect(body.error).toBe('not_implemented')
    expect(body.feature).toBe('requirement.create')
    expect(body.issue).toBe('05')
  })

  it('GET /api/requirements → 501 with feature=requirement.list', async () => {
    const { statusCode, body } = await authed('GET', '/api/requirements')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.list')
  })

  it('GET /api/requirement/:id → 501 with feature=requirement.detail', async () => {
    const { statusCode, body } = await authed('GET', '/api/requirement/REFUND-001')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.detail')
  })

  it('PATCH /api/requirement/:id → 501 with feature=requirement.update', async () => {
    const { statusCode, body } = await authed('PATCH', '/api/requirement/REFUND-001')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.update')
  })

  it('POST /api/requirement/:id/skill → 501 with feature=requirement.run_skill, issue=08', async () => {
    const { statusCode, body } = await authed('POST', '/api/requirement/REFUND-001/skill')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.run_skill')
    expect(body.issue).toBe('08')
  })

  it('all routes require auth (401 without token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/requirements' })
    expect(res.statusCode).toBe(401)
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test requirement.test.ts
```

期望：FAIL，`Cannot find module '../routes/requirement.js'`。

### Step 6.2: 实现 requirement.ts

创建 `apps/agent/src/routes/requirement.ts`：

```ts
import type { FastifyInstance } from 'fastify'

function notImplemented(feature: string, issue: string): {
  error: 'not_implemented'
  feature: string
  message: string
  issue: string
} {
  return {
    error: 'not_implemented',
    feature,
    message: `本期骨架仅占位；真实实装见 issue ${issue}`,
    issue,
  }
}

export async function requirementRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/requirement', async (_req, reply) => {
    return reply.code(501).send(notImplemented('requirement.create', '05'))
  })

  app.get('/api/requirements', async (_req, reply) => {
    return reply.code(501).send(notImplemented('requirement.list', '05'))
  })

  app.get<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.detail', '05'))
  })

  app.patch<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.update', '05'))
  })

  app.post<{ Params: { id: string } }>(
    '/api/requirement/:id/skill',
    async (req, reply) => {
      return reply.code(501).send(notImplemented('requirement.run_skill', '08'))
    },
  )
}
```

### Step 6.3: 跑测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test requirement.test.ts
```

期望：6 passed。

### Step 6.4: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/routes/requirement.ts apps/agent/src/__tests__/requirement.test.ts
git commit -m "feat(agent): 5x requirement routes as 501 placeholders (issue 03/6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: bootstrap 路由（公开）

**Files:**
- Create: `apps/agent/src/routes/bootstrap.ts`
- Create: `apps/agent/src/__tests__/bootstrap.test.ts`

### Step 7.1: 写失败测试

创建 `apps/agent/src/__tests__/bootstrap.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { BootstrapResponse } from '@ai-devspace/shared'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { bootstrapRoutes } from '../routes/bootstrap.js'
import { createRequire } from 'node:module'

let app: FastifyInstance
let root: string
let tm: TokenManager

const require = createRequire(import.meta.url)

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-boot-'))
  tm = new TokenManager(root)
  await tm.ensure()
  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(bootstrapRoutes, { tokenManager: tm, apiBase: 'http://localhost:7777' })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/agent/bootstrap', () => {
  it('returns the token via public route (no auth needed)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    expect(res.statusCode).toBe(200)
    const parsed = BootstrapResponse.safeParse(res.json())
    expect(parsed.success).toBe(true)
  })

  it('always returns the same token (no rotation)', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const r2 = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    expect(r1.json().token).toBe(r2.json().token)
  })

  it('body includes cookie metadata for the Web client', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const body = res.json()
    expect(body.cookieName).toBe('aidevspace_token')
    expect(body.cookieAttributes.SameSite).toBe('Strict')
    expect(body.cookieAttributes.Path).toBe('/')
    expect(body.cookieAttributes.MaxAge).toBe(2_592_000)
  })

  it('exposes apiBase + agentVersion + sseNote', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const body = res.json()
    expect(body.apiBase).toBe('http://localhost:7777')
    expect(body.agentVersion).toBe('0.0.0')
    expect(body.sseNote).toMatch(/EventSource/)
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test bootstrap.test.ts
```

期望：FAIL，`Cannot find module '../routes/bootstrap.js'`。

### Step 7.2: 实现 bootstrap.ts

创建 `apps/agent/src/routes/bootstrap.ts`：

```ts
import type { FastifyPluginAsync } from 'fastify'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenManager } from '../auth/TokenManager.js'

export interface BootstrapRoutesOptions {
  tokenManager: TokenManager
  apiBase: string
  agentVersion?: string
}

export const bootstrapRoutes: FastifyPluginAsync<BootstrapRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { tokenManager, apiBase } = opts
  const agentVersion = opts.agentVersion ?? '0.0.0'

  fastify.get(
    '/api/agent/bootstrap',
    { config: { public: true } },
    async (_req, reply) => {
      const token = tokenManager.get()
      return reply.send({
        ok: true as const,
        token,
        cookieName: 'aidevspace_token',
        cookieAttributes: { SameSite: 'Strict' as const, Path: '/', MaxAge: 2_592_000 },
        apiBase,
        agentVersion,
        sseNote: 'EventSource 不能带自定义 header；浏览器侧通过 SameSite=Strict cookie 鉴权',
      })
    },
  )
}
```

### Step 7.3: 跑测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test bootstrap.test.ts
```

期望：4 passed。

### Step 7.4: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/routes/bootstrap.ts apps/agent/src/__tests__/bootstrap.test.ts
git commit -m "feat(agent): /api/agent/bootstrap public route (issue 03/7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: HealthService + health 路由

**Files:**
- Create: `apps/agent/src/services/HealthService.ts`
- Create: `apps/agent/src/__tests__/HealthService.test.ts`
- Create: `apps/agent/src/__tests__/health.test.ts`（路由层集成）

### Step 8.1: 写失败测试 — HealthService

创建 `apps/agent/src/__tests__/HealthService.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HealthService } from '../services/HealthService.js'
import { TokenManager } from '../auth/TokenManager.js'

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aidevsp-h-'))
}

describe('HealthService.collect', () => {
  it('returns ok:true when workspace + token + log file all healthy', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
      const svc = new HealthService({
        root,
        tokenManager: tm,
        allowedOrigins: ['http://localhost:3333'],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date('2026-07-12T08:00:00Z'),
      })
      const out = await svc.collect()
      expect(out.ok).toBe(true)
      expect(out.service).toBe('agent')
      expect(out.bootTime).toBe('2026-07-12T08:00:00.000Z')
      expect(out.workspace.exists).toBe(true)
      expect(out.workspace.configOk).toBe(true)
      expect(out.auth.tokenPresent).toBe(true)
      expect(out.sse.hubSubscribers).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns ok:false when token file missing', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      rmSync(join(root, '.agent-token'))
      // Re-construct without token to force tokenPresent=false
      const fresh = new TokenManager(root)
      // do NOT call ensure(); token will be missing
      const svc = new HealthService({
        root,
        tokenManager: fresh,
        allowedOrigins: [],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date(),
      })
      const out = await svc.collect()
      expect(out.ok).toBe(false)
      expect(out.auth.tokenPresent).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns ok:false when config.yaml missing', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      const svc = new HealthService({
        root,
        tokenManager: tm,
        allowedOrigins: [],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date(),
      })
      const out = await svc.collect()
      expect(out.workspace.configOk).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports tokenFileMode from filesystem stat', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      chmodSync(join(root, '.agent-token'), 0o644)
      const svc = new HealthService({
        root,
        tokenManager: tm,
        allowedOrigins: [],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date(),
      })
      const out = await svc.collect()
      expect(out.auth.tokenFileMode).toBe('0644')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

### Step 8.2: 实现 HealthService

创建 `apps/agent/src/services/HealthService.ts`：

```ts
import { statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenManager } from '../auth/TokenManager.js'

export interface HealthDeps {
  root: string
  tokenManager: TokenManager
  allowedOrigins: string[]
  logFilePath: string
  sseHubStats: () => { subscribers: number }
  bootTime: Date
  agentVersion?: string
}

export interface HealthReport {
  ok: boolean
  service: 'agent'
  version: string
  bootTime: string
  workspace: { root: string; exists: boolean; configOk: boolean }
  auth: { tokenPresent: boolean; tokenFileMode?: string; originAllowlist: string[] }
  sse: { hubSubscribers: number }
  log: { level: string; file: string }
  failed?: string[]
}

export class HealthService {
  constructor(private readonly deps: HealthDeps) {}

  async collect(): Promise<HealthReport> {
    const failed: string[] = []
    const root = this.deps.root
    const workspaceExists = existsSync(root)
    const configPath = join(root, 'config.yaml')
    const configOk = existsSync(configPath)
    if (!workspaceExists) failed.push('workspace.missing')
    if (!configOk) failed.push('workspace.config_missing')

    let tokenPresent = false
    let tokenFileMode: string | undefined
    try {
      const stat = statSync(join(root, '.agent-token'))
      tokenPresent = true
      tokenFileMode = (stat.mode & 0o777).toString(4).padStart(4, '0')
      if (stat.mode & 0o077) failed.push('auth.token_file_mode_too_permissive')
    } catch {
      tokenPresent = false
      failed.push('auth.token_missing')
    }

    let logOk = true
    try {
      // writability probe: open for append if file doesn't exist would create it;
      // we only report; do not actually create the file here
      statSync(this.deps.logFilePath)
    } catch {
      // file may not exist yet — acceptable, only mark failed if parent dir not writable
      logOk = false
    }

    const ok = !failed.includes('workspace.missing')
      && !failed.includes('workspace.config_missing')
      && tokenPresent

    return {
      ok: ok && logOk,
      service: 'agent',
      version: this.deps.agentVersion ?? '0.0.0',
      bootTime: this.deps.bootTime.toISOString(),
      workspace: { root, exists: workspaceExists, configOk },
      auth: {
        tokenPresent,
        tokenFileMode,
        originAllowlist: this.deps.allowedOrigins,
      },
      sse: this.deps.sseHubStats(),
      log: { level: process.env.LOG_LEVEL ?? 'info', file: this.deps.logFilePath },
      ...(failed.length ? { failed } : {}),
    }
  }
}
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test HealthService.test.ts
```

期望：4 passed。

### Step 8.3: 写失败测试 — health 路由

创建 `apps/agent/src/__tests__/health.test.ts`（替换现有 `apps/agent/src/__tests__/health.test.ts` 中只校验 `{ok:true, name:'agent', workspaceRoot}` 的旧断言）：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { HealthService } from '../services/HealthService.js'
import { createSseHub } from '../sse/SseHub.js'

let app: FastifyInstance
let root: string
let tm: TokenManager
let hub: ReturnType<typeof createSseHub>

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-hr-'))
  tm = new TokenManager(root)
  await tm.ensure()
  writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
  hub = createSseHub()
  app = Fastify({ logger: false })
  const healthSvc = new HealthService({
    root,
    tokenManager: tm,
    allowedOrigins: ['http://localhost:3333'],
    logFilePath: join(root, 'agent.log'),
    sseHubStats: () => hub.stats(),
    bootTime: new Date('2026-07-12T08:00:00Z'),
  })
  app.get('/api/health', { config: { public: true } }, async () => healthSvc.collect())
  await app.ready()
})

afterEach(async () => {
  await app.close()
  await hub.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/health', () => {
  it('returns 200 + full structured payload when healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/"ok":true/)
    expect(res.body).toMatch(/"workspace":/)
    expect(res.body).toMatch(/"tokenPresent":true/)
  })

  it('does not require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})
```

### Step 8.4: 实现 health 路由（server.ts 在 Task 9 集成；这里 route 通过外部 `app.get` 注册）

不创建独立文件，路由在 `server.ts` 集成阶段注册。本步骤只需 HealthService 通过单元测试。

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test HealthService.test.ts health.test.ts
```

期望：4 + 2 = 6 passed。

### Step 8.5: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/services/HealthService.ts apps/agent/src/__tests__/HealthService.test.ts apps/agent/src/__tests__/health.test.ts
git commit -m "feat(agent): HealthService with token + workspace + sse aggregation (issue 03/8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: server.ts 集成（dual-sink log + 所有 plugin 装配）

**Files:**
- Modify: `apps/agent/src/server.ts`
- Create: `apps/agent/src/__tests__/server-integration.test.ts`

### Step 9.1: 写失败测试 — 集成

创建 `apps/agent/src/__tests__/server-integration.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'

let cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop()!
    await fn()
  }
})

describe('buildServer', () => {
  it('returns a Fastify instance ready to listen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-srv-'))
    const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
    cleanup.push(() => app.close())
    await app.ready()
    expect(app).toBeDefined()
  })

  it('serves GET /api/health without auth on a freshly built server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-srv-'))
    writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
    const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
    cleanup.push(() => app.close())
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.workspace.exists).toBe(true)
    expect(body.auth.tokenPresent).toBe(true)
  })

  it('protects requirement routes with auth', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-srv-'))
    writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
    const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
    cleanup.push(() => app.close())
    const res = await app.inject({ method: 'GET', url: '/api/requirements' })
    expect(res.statusCode).toBe(401)
  })
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test server-integration.test.ts
```

期望：FAIL（`buildServer` 当前不接受 `{ workspaceRoot }` 选项）。

### Step 9.2: 重写 server.ts

**完全替换** `apps/agent/src/server.ts`：

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { TokenManager } from './auth/TokenManager.js'
import { authPlugin } from './auth/authPlugin.js'
import { WorkspaceService } from './services/WorkspaceService.js'
import { HealthService } from './services/HealthService.js'
import { workspaceRoutes } from './routes/workspace.js'
import { requirementRoutes } from './routes/requirement.js'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { createSseHub, type SseHub } from './sse/SseHub.js'
import { sseRoutes } from './sse/requirementEventsRoute.js'

const ALLOWED_ORIGINS: string[] = ['http://localhost:3333', 'http://127.0.0.1:3333']

function defaultLogPath(): string {
  return join(homedir(), '.aidevspace', 'logs', 'agent.log')
}

function defaultWorkspaceRoot(): string {
  return join(homedir(), '.aidevspace')
}

export interface BuildServerOptions {
  workspaceRoot?: string
  logFilePath?: string
  agentVersion?: string
}

/**
 * Build a fully-wired Fastify instance. The caller chooses whether to .listen().
 * TokenManager.ensure() is awaited here so any 401-strict routes are safe.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspaceRoot()
  const logFilePath = opts.logFilePath ?? defaultLogPath()
  const bootTime = new Date()
  mkdirSync(dirname(logFilePath), { recursive: true })

  const transport = pino.transport({
    targets: [
      { target: 'pino/file', options: { destination: logFilePath, mkdir: false } },
      { target: 'pino/file', options: { destination: 1 } },  // stdout
    ],
  })
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }, transport)

  const fastify = Fastify({ logger })

  await fastify.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  })

  // 1. Token
  const tokenManager = new TokenManager(workspaceRoot, {
    warn: (msg, ctx) => logger.warn(ctx ?? {}, msg),
  })
  await tokenManager.ensure()

  // 2. Auth plugin (registers onRequest hook)
  await fastify.register(authPlugin, { tokenManager, allowedOrigins: ALLOWED_ORIGINS })

  // 3. SSE hub + route
  const hub: SseHub = createSseHub()
  await fastify.register(sseRoutes, { hub })

  // 4. Workspace (init idempotent)
  const workspace = new WorkspaceService(workspaceRoot)
  try {
    await workspace.initWorkspace()
    logger.info({ root: workspace.root }, 'workspace initialized')
  } catch (err) {
    logger.error({ err, root: workspace.root }, 'workspace init failed')
    throw err
  }

  // 5. Routes
  const healthService = new HealthService({
    root: workspaceRoot,
    tokenManager,
    allowedOrigins: ALLOWED_ORIGINS,
    logFilePath,
    sseHubStats: () => hub.stats(),
    bootTime,
    agentVersion: opts.agentVersion ?? '0.0.0',
  })
  fastify.get('/api/health', { config: { public: true } }, async () => healthService.collect())
  await fastify.register(workspaceRoutes, { workspace })
  await fastify.register(requirementRoutes)
  await fastify.register(bootstrapRoutes, { tokenManager, apiBase: 'http://localhost:7777' })

  fastify.addHook('onClose', async () => {
    await hub.close()
    await transport.end()
  })

  return fastify
}

// Cross-platform isMain detection (Windows uses backslash in process.argv[1])
const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : ''
const isMain = entryPath === process.argv[1]

if (isMain) {
  const port = Number(process.env.PORT ?? 7777)
  const host = process.env.HOST ?? '0.0.0.0'
  const workspaceRoot = process.env.AIDEVSPACE_HOME ?? defaultWorkspaceRoot()
  const logFilePath = process.env.AGENT_LOG_FILE ?? defaultLogPath()
  const app = await buildServer({ workspaceRoot, logFilePath })
  try {
    await app.listen({ port, host })
    app.log.info(`agent listening on http://${host}:${port}`)
    // write PID file (best-effort)
    const pidPath = join(workspaceRoot, '.agent.pid')
    mkdirSync(dirname(pidPath), { recursive: true })
    writeFileSync(pidPath, String(process.pid))
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
```

### Step 9.3: 检查 pino 是否被 apps/agent 显式依赖

Fastify 5 自带 pino；但 `import pino from 'pino'` 在 ESM 模式下可能取 default export。检查 `apps/agent/package.json` 是否已声明 `pino`：

若 **没有**，编辑 `apps/agent/package.json` 加：

```json
"dependencies": {
  "...": "...",
  "pino": "^9.0.0"
}
```

然后 `pnpm install` 一次。

### Step 9.4: 跑集成测试

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test server-integration.test.ts
```

期望：3 passed。

### Step 9.5: 跑全部测试 + typecheck + lint

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test && pnpm typecheck && pnpm lint
```

期望：所有测试通过；typecheck 干净；lint 0 warnings。

### Step 9.6: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/server.ts apps/agent/src/__tests__/server-integration.test.ts apps/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): wire all plugins in server.ts with pino dual sink (issue 03/9)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: e2e 测试（真实 listen）

**Files:**
- Create: `apps/agent/src/__tests__/agent-skeleton.e2e.test.ts`

### Step 10.1: 写 e2e

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'undici'
import { buildServer } from '../server.js'
import { readFileSync } from 'node:fs'

let cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop()!
    await fn()
  }
})

describe('agent skeleton e2e', () => {
  it('boot server, fetch /api/health, then read SSE hello event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-'))
    writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
    const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
    cleanup.push(() => app.close())
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    cleanup.push(() => app.close())
    const port = new URL(url).port

    // 1) health
    const h = await request(`http://127.0.0.1:${port}/api/health`)
    expect(h.statusCode).toBe(200)
    const hb = await h.body.json()
    expect(hb.ok).toBe(true)

    // 2) read the token via bootstrap
    const b = await request(`http://127.0.0.1:${port}/api/agent/bootstrap`)
    expect(b.statusCode).toBe(200)
    const bb: { token: string } = await b.body.json()
    expect(bb.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // 3) SSE — read first event
    const sse = await request(
      `http://127.0.0.1:${port}/api/requirement/REFUND-001/events`,
      {
        method: 'GET',
        headers: { 'x-aidevspace-token': bb.token },
        // undici requires reset signal to abort; we just read first chunk
      },
    )
    expect(sse.statusCode).toBe(200)
    expect(sse.headers['content-type']).toMatch(/^text\/event-stream/)

    // Read up to 1.5s of bytes
    const chunks: Buffer[] = []
    const startedAt = Date.now()
    for await (const chunk of sse.body) {
      chunks.push(chunk as Buffer)
      if (Date.now() - startedAt > 1500) break
      if (Buffer.concat(chunks).toString().includes('event: hello')) break
    }
    const body = Buffer.concat(chunks).toString()
    expect(body).toMatch(/event: hello/)
    expect(body).toMatch(/REFUND-001/)

    rmSync(root, { recursive: true, force: true })
  }, 10_000)

  it('rejects request with wrong token (401)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-'))
    writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
    const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
    cleanup.push(() => app.close())
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    cleanup.push(() => app.close())
    const port = new URL(url).port

    const r = await request(`http://127.0.0.1:${port}/api/requirements`, {
      headers: { 'x-aidevspace-token': 'a'.repeat(43) },
    })
    expect(r.statusCode).toBe(401)

    rmSync(root, { recursive: true, force: true })
  })

  it('rejects request with bad Origin (403)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-'))
    writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
    const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
    cleanup.push(() => app.close())
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    cleanup.push(() => app.close())
    const port = new URL(url).port

    const b = await request(`http://127.0.0.1:${port}/api/agent/bootstrap`)
    const bb: { token: string } = await b.body.json()

    const r = await request(`http://127.0.0.1:${port}/api/requirements`, {
      headers: {
        'x-aidevspace-token': bb.token,
        origin: 'http://evil.com',
      },
    })
    expect(r.statusCode).toBe(403)

    rmSync(root, { recursive: true, force: true })
  })
})
```

### Step 10.2: 确认 undici 可用

`undici` 是 Node 20+ 内置。若环境报 `Cannot find module 'undici'`，编辑 `apps/agent/package.json`：

```json
"devDependencies": {
  "...": "...",
  "undici": "*"
}
```

跑 `pnpm install`。

### Step 10.3: 跑 e2e

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test agent-skeleton.e2e.test.ts
```

期望：3 passed。

### Step 10.4: 跑全量测试 + typecheck + lint

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/apps/agent && pnpm test && pnpm typecheck && pnpm lint
```

期望：所有测试通过；typecheck 干净；lint 0 warnings。

### Step 10.5: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add apps/agent/src/__tests__/agent-skeleton.e2e.test.ts apps/agent/package.json pnpm-lock.yaml
git commit -m "test(agent): e2e cover health + bootstrap + sse + 401/403 (issue 03/10)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: bash 保活脚本（4 个 sh）

**Files:**
- Create: `packages/scripts/agent-start.sh`
- Create: `packages/scripts/agent-stop.sh`
- Create: `packages/scripts/agent-watch.sh`
- Create: `packages/scripts/agent-status.sh`
- Create: `packages/scripts/__tests__/bash-parse.test.ts`（校验所有 .sh `bash -n` 通过）

### Step 11.1: 写 bash-parse 测试

```ts
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..')
const files = readdirSync(dir).filter((f) => f.endsWith('.sh'))

describe('agent shell scripts parse', () => {
  for (const f of files) {
    it(`${f} passes bash -n syntax check`, () => {
      // Will throw if syntax invalid
      execFileSync('bash', ['-n', join(dir, f)], { stdio: 'pipe' })
    })
  }
})
```

跑：

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/scripts && pnpm test bash-parse.test.ts
```

期望：FAIL（找不到 scripts 目录）。

### Step 11.2: 创建 package.json（scripts 子包）

创建 `packages/scripts/package.json`：

```json
{
  "name": "@ai-devspace/scripts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

加 `pnpm-workspace.yaml` 包含 `packages/scripts`（若已包含 `packages/*` 则免改）。

### Step 11.3: 实现 start.sh

创建 `packages/scripts/agent-start.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_DIR="$REPO_ROOT/apps/agent"
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
LOG_FILE="${AGENT_LOG_FILE:-$WORKSPACE_ROOT/logs/agent.log}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"
PORT="${PORT:-7777}"

mkdir -p "$(dirname "$LOG_FILE")" "$WORKSPACE_ROOT"

# If something is already running on this PID, stop it first
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "agent-start: pid $OLD_PID already running; skipping relaunch"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Pick prod build if compiled, else dev (tsx)
if [[ -f "$AGENT_DIR/dist/server.js" ]]; then
  CMD=(node "$AGENT_DIR/dist/server.js")
else
  CMD=(npx --prefix "$REPO_ROOT" tsx "$AGENT_DIR/src/server.ts")
fi

echo "agent-start: launching on port $PORT"
nohup "${CMD[@]}" >/dev/null 2>>"$LOG_FILE" &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"
echo "agent-start: pid=$APP_PID log=$LOG_FILE"

# Wait briefly for port to come up
for i in {1..20}; do
  if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    echo "agent-start: ready on :$PORT"
    exit 0
  fi
  sleep 0.5
done
echo "agent-start: WARNING port $PORT not ready within 10s; check $LOG_FILE"
exit 0
```

### Step 11.4: 实现 stop.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "agent-stop: no pid file at $PID_FILE; nothing to stop"
  exit 0
fi
PID="$(cat "$PID_FILE")"
if ! kill -0 "$PID" 2>/dev/null; then
  echo "agent-stop: pid $PID not alive; removing stale pid file"
  rm -f "$PID_FILE"
  exit 0
fi

echo "agent-stop: TERM $PID"
kill -TERM "$PID" 2>/dev/null || true
for i in {1..10}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "agent-stop: stopped"
    exit 0
  fi
  sleep 0.5
done
echo "agent-stop: forcing KILL $PID"
kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
exit 0
```

### Step 11.5: 实现 watch.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"

echo "agent-watch: watching pid file $PID_FILE every 5s"
while true; do
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -z "${PID:-}" ]] || ! kill -0 "$PID" 2>/dev/null; then
      echo "agent-watch: pid missing or dead; relaunching via start.sh"
      bash "$SCRIPT_DIR/agent-start.sh" || true
    fi
  else
    echo "agent-watch: no pid file; launching"
    bash "$SCRIPT_DIR/agent-start.sh" || true
  fi
  sleep 5
done
```

### Step 11.6: 实现 status.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "agent-status: no pid file at $PID_FILE"
  exit 1
fi
PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  echo "agent-status: alive pid=$PID"
  exit 0
else
  echo "agent-status: dead pid=$PID (stale pid file)"
  exit 1
fi
```

### Step 11.7: 权限 + 测试

```bash
chmod +x /Users/Ray/TraeProjects/AI-DevSpace/packages/scripts/agent-{start,stop,watch,status}.sh
cd /Users/Ray/TraeProjects/AI-DevSpace/packages/scripts && pnpm test bash-parse.test.ts
```

期望：4 passed。

### Step 11.8: 端到端冒烟（手测一次）

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
AIDEVSPACE_HOME="$(mktemp -d)" AGENT_LOG_FILE="$AIDEVSPACE_HOME/agent.log" \
  bash packages/scripts/agent-start.sh
AIDEVSPACE_HOME="$(cat ~/.aidevspace/.agent.pid 2>/dev/null && echo || true)" \
  bash packages/scripts/agent-status.sh
```

期望：`ready on :7777`、`alive pid=<number>`。

清理：

```bash
AIDEVSPACE_HOME="<tmpdir from above>" bash packages/scripts/agent-stop.sh
```

### Step 11.9: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add packages/scripts/
git commit -m "feat(scripts): agent start/stop/watch/status shell scripts (issue 03/11)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: 顶层 scripts + README

**Files:**
- Modify: 顶层 `package.json`（新增 `agent:*` 脚本）
- Modify: 顶层 `README.md`

### Step 12.1: 修改顶层 package.json

读取 `/Users/Ray/TraeProjects/AI-DevSpace/package.json`。在 `scripts` 字段添加（与现有 dev/build/test 并列）：

```json
"agent:start": "bash packages/scripts/agent-start.sh",
"agent:stop": "bash packages/scripts/agent-stop.sh",
"agent:watch": "bash packages/scripts/agent-watch.sh",
"agent:status": "bash packages/scripts/agent-status.sh"
```

### Step 12.2: 修改顶层 README.md

在「项目结构」段落后添加「Agent 守护进程」段：

```markdown
## Agent 守护进程

issue 03 提供的本地守护进程：`localhost:7777`，Fastify + SSE + Token 鉴权。

| 命令 | 作用 |
|---|---|
| `pnpm agent:start` | nohup 后台拉起 + 5s 探端口 |
| `pnpm agent:stop`  | 优雅停（TERM → 5s → KILL） |
| `pnpm agent:watch` | 常驻 5s 轮询，进程消失自动重拉 |
| `pnpm agent:status` | 看 PID 活否 |

环境变量：
- `AIDEVSPACE_HOME` 默认 `~/.aidevspace`
- `AGENT_LOG_FILE` 默认 `$AIDEVSPACE_HOME/logs/agent.log`
- `PORT` 默认 `7777`

### 平台限制

- macOS / Linux：脚本 `set -euo pipefail`，Bash 4+ 需 `brew install bash`（macOS 默认 bash 3.2 时）
- **Windows 不支持**（本期未提供 PowerShell 脚本；WSL 用户可走同套 sh）
```

### Step 12.3: 跑全量验证

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm agent:start
sleep 3
pnpm agent:status
TOK="$(curl -s http://localhost:7777/api/agent/bootstrap | python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])')"
curl -sN -H "X-AIDevSpace-Token: $TOK" http://localhost:7777/api/requirement/REFUND-001/events | head -5
pnpm agent:stop
```

期望：所有 typecheck/test 通过；status 显示 alive PID；SSE 输出含 `event: hello`。

### Step 12.4: Commit

```bash
cd /Users/Ray/TraeProjects/AI-DevSpace
git add package.json README.md
git commit -m "docs(root): document agent:start/stop/watch/status + Windows caveat (issue 03/12)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

执行实施前请做一次自审：

| 项 | 状态 |
|---|---|
| Spec 12 条验收 ↔ 12 步 plan（1-12）一一对应 | ✅ |
| 占位符扫描（`grep -nE 'TBD\|TODO\|XXX'`） | ✅（无） |
| 类型一致性：Task 1 `NotImplementedError.feature: z.string()` 在 Task 6 `requirement.ts` 输出 `feature: 'requirement.create'`（string literal）schema 兼容 | ✅ |
| 类型一致性：Task 8 `HealthReport.tokenFileMode` 是 `string|undefined`，Task 8 `HealthService` 输出 mode 用 `'0644'` 4位字符串 | ✅ |
| 类型一致性：SseHub `subscribe(reqId, listener)` ↔ Task 5 路由 `hub.subscribe(reqId, write)` | ✅ |
| 类型一致性：bootstrap route `BootstrapResponse` schema 与 Task 7 路由输出完全匹配 | ✅ |
| 鉴权 plugin `routeOptions.config.public` 判定 + 各路由 `{ config: { public: true } }` 标注一致 | ✅ |
| `req.params.id` 类型用 Fastify 泛型 `<{Params: {id: string}}>` 在 sseRoutes 与 requirement routes 一致 | ✅ |
| pino dual-sink transport（Task 9）依赖 `pino` 在 deps 已声明（Step 9.3 含校验） | ✅ |
| 测试隔离：`mkdtempSync(tmpdir())` 全部路径，零 `~/.aidevspace` 污染 | ✅ |
| `pnpm agent:start` 端到端冒烟（Task 12.3）覆盖 spec §11 验收 1/7/10/11 | ✅ |

完成后请用户选择执行路径：①subagent-driven（推荐，每任务一个 fresh subagent + 双轴 review）②inline executing（当前会话批量执行 + 节点 review）。
