# P4 错误 UI 暴露(Web 端)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 端 EXECUTING 工位暴露 Agent 已发出的 retrying/failed/cancelled 错误状态,补 `/sessions/:sid/retry` endpoint 支持 UI 重试,并一次性把 CircuitBreaker 重命名为 ProviderSemaphore。

**Architecture:**
- **Agent 端**:新增 `/sessions/:sid/retry` route;`AISession.runTurn` 加 `isRetry` 入参(首 retry 间隔=0);`AISession` 写 `meta.last_input`;`RetryStrategy` 加 `initialDelayMs` 参数
- **Shared**:`sse.ts` 加 `query_succeeded` 变体
- **Web 端**:新增 `useExecutingSse` hook 订阅 SSE;新增 `Toast` + `ToastHost` 组件;`EXECUTING` 组件 StageStrip/Toolbar/AIEventColumn 据状态渲染
- **重命名**:CircuitBreaker → ProviderSemaphore 一次性替换

**Tech Stack:** TypeScript (strict)、Vitest、@testing-library/react、Fastify (agent HTTP)、Next.js App Router (web)、EventSource (浏览器 SSE)

## Global Constraints

- **TypeScript strict 模式**:所有新代码必须通过 `tsc --noEmit`,不允许 `any` / `@ts-ignore`(JSDoc 注释除外)
- **测试框架**:Agent 端 Vitest;Web 端 Vitest + @testing-library/react + jsdom
- **TDD 严格**:每步「红 → 绿 → 重构」,严禁先写实现再补测试
- **Commit 频率**:每完成一个 task 立即 commit;commit message 用 conventional commits 格式
- **CLAUDE.md dev/build 隔离**:本期不跑 `next build`,只跑 `vitest run` + `tsc --noEmit`
- **命名规范**:文件名 PascalCase(类) / camelCase(util/hook)/ kebab-case(test fixtures);导出的类/接口 PascalCase,变量/函数 camelCase
- **错误分类字面量**:`'A' | 'B' | 'C' | 'D' | 'E' | 'cancelled'`(与 ErrorClassifier 完全一致)
- **退避序列**:`[1000, 3000, 10000]` 毫秒(A/D 默认);retry 路径 `[0, 3000, 10000]`
- **并发上限**:5(ProviderSemaphore 默认 limit)
- **路径常量**:agent.log 默认 `~/.aidevspace/logs/agent.log`(由 `server.ts` 的 `defaultLogPath()` 提供)
- **SSE Hub 频道**:`reqId` 作为频道 key(与现有 SseHub 实现一致)

---

## File Structure

**Agent 端 `apps/agent/src/`**:

| 文件 | 操作 | 职责 |
|---|---|---|
| `error/ProviderSemaphore.ts` | 新建(替换 CircuitBreaker.ts) | Provider-scoped FIFO 并发门控 |
| `error/RetryStrategy.ts` | 改 | 加 `initialDelayMs` 参数 |
| `routes/sessionsRetryRoute.ts` | 新建 | POST /sessions/:sid/retry endpoint |
| `session/AISession.ts` | 改 | 加 `isRetry` 入参 + `last_input` 写入 + DI 字段改名 |
| `providers/ClaudeCodeProvider.ts` | 改 | CircuitBreaker → ProviderSemaphore |
| `server.ts` | 改 | import + 实例化改名 + 注册 retry route |

**Shared `packages/shared/src/`**:

| 文件 | 操作 | 职责 |
|---|---|---|
| `sse.ts` | 改 | 加 `query_succeeded` 变体 |

**Web 端 `apps/web/src/`**:

| 文件 | 操作 | 职责 |
|---|---|---|
| `lib/useExecutingSse.ts` | 新建 | SSE 客户端 hook + reducer |
| `components/toast.tsx` | 新建 | 单 Toast 组件 |
| `components/toast-host.tsx` | 新建 | Toast 容器(堆叠) |
| `components/executing-zone.tsx` | 改 | StageStrip/Toolbar/AIEventColumn 扩展 + 顶层接线 |
| `lib/executing.ts` | 改 | `ExecutingData` 加可选 `sessionId`/`reqId` |

**测试文件**(同上路径加 `__tests__/` 或同级 `*.test.ts(x)`)

---

## Task 1: ProviderSemaphore 重命名(无逻辑改动)

**Files:**
- Create: `apps/agent/src/error/ProviderSemaphore.ts`
- Create: `apps/agent/src/__tests__/ProviderSemaphore.test.ts`
- Delete: `apps/agent/src/error/CircuitBreaker.ts`
- Delete: `apps/agent/src/__tests__/CircuitBreaker.test.ts`
- Modify: `apps/agent/src/providers/ClaudeCodeProvider.ts`(改 import + 1 处实例化)
- Modify: `apps/agent/src/session/AISession.ts`(改 import + DI 字段)
- Modify: `apps/agent/src/server.ts`(改 import + 1 处实例化)

**Interfaces:**
- Consumes: 现有 `CircuitBreaker` 的所有方法签名(`new CircuitBreaker({ limit? })`、`run<T>(op, signal?)`、`stats()`、`close(reason?)`)
- Produces: `class ProviderSemaphore` 导出相同 API;`type ProviderSemaphoreStats = { limit, active, queued }`

- [ ] **Step 1: 先全局扫描确认改动面**

Run:
```bash
cd d:/TraeProject/AI-DevSpace
grep -rn "CircuitBreaker" apps/ packages/ --include="*.ts" --include="*.tsx"
```

Expected: 列出所有 import/引用位置(预期 ~6 处:`CircuitBreaker.ts` + `CircuitBreaker.test.ts` + `ClaudeCodeProvider.ts` + `AISession.ts` + `server.ts` + 可能的 `agent-skeleton.e2e.test.ts`)。

- [ ] **Step 2: 创建 `ProviderSemaphore.ts`(复制 + 注释更新)**

Create `apps/agent/src/error/ProviderSemaphore.ts`:

```ts
/**
 * ProviderSemaphore — Provider-scoped FIFO concurrency semaphore.
 *
 * Enforces a per-Provider in-flight limit (default 5 concurrent queries).
 * Excess callers await a release function in FIFO order. Renamed from the
 * historical `CircuitBreaker` (which was misleading: this class does NOT
 * trip on a failure rate).
 *
 * Behavior:
 * - `limit` concurrent operations (default 5).
 * - Excess callers await a release function in FIFO order.
 * - Releasing hands the slot directly to the next waiter (no active count dip).
 * - `AbortSignal` removes the waiter from the queue without consuming a slot.
 * - `close()` rejects all queued waiters and refuses new acquires.
 */
interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface ProviderSemaphoreStats {
  limit: number
  active: number
  queued: number
}

export class ProviderSemaphore {
  readonly #limit: number
  #active = 0
  #closed = false
  #waiters: Waiter[] = []

  constructor(options: { limit?: number } = {}) {
    this.#limit = options.limit ?? 5
    if (!Number.isInteger(this.#limit) || this.#limit < 1) {
      throw new Error('ProviderSemaphore limit must be a positive integer')
    }
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.#acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  stats(): ProviderSemaphoreStats {
    return { limit: this.#limit, active: this.#active, queued: this.#waiters.length }
  }

  close(reason: unknown = new Error('ProviderSemaphore closed')): void {
    this.#closed = true
    const waiters = this.#waiters.splice(0)
    for (const waiter of waiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort)
      waiter.reject(reason)
    }
  }

  async #acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.#closed) throw new Error('ProviderSemaphore is closed')
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (this.#active < this.#limit) {
      this.#active++
      return this.#releaseFactory()
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      waiter.abort = (): void => {
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        reject(new DOMException('aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', waiter.abort, { once: true })
      this.#waiters.push(waiter)
    })
  }

  #releaseFactory(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.#waiters.shift()
      if (next) {
        if (next.abort && next.signal) next.signal.removeEventListener('abort', next.abort)
        next.resolve(this.#releaseFactory())
      } else {
        this.#active--
      }
    }
  }
}
```

- [ ] **Step 3: 创建 `ProviderSemaphore.test.ts`(复制 CircuitBreaker 测试 + describe 名改)**

Create `apps/agent/src/__tests__/ProviderSemaphore.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ProviderSemaphore } from '../error/ProviderSemaphore.js'

describe('ProviderSemaphore', () => {
  it('runs five operations and queues the sixth until a slot is released', async () => {
    const sem = new ProviderSemaphore({ limit: 5 })
    const order: number[] = []
    const tasks = Array.from({ length: 6 }, (_, i) =>
      sem.run(async () => {
        order.push(i)
        await new Promise((r) => setTimeout(r, 5))
      }),
    )
    await Promise.all(tasks)
    // 前 5 个并发跑完才放第 6 个 → order 中 5 在 6 之前
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5))
  })

  it('serves queued operations in FIFO order and releases on rejection', async () => {
    const sem = new ProviderSemaphore({ limit: 1 })
    const order: string[] = []
    const t1 = sem.run(async () => {
      order.push('t1')
      await new Promise((r) => setTimeout(r, 10))
    })
    const t2 = sem.run(async () => {
      order.push('t2')
    }).catch(() => {})
    const t3 = sem.run(async () => {
      order.push('t3')
    })
    sem.close()
    await t1
    await t2
    await t3
    expect(order[0]).toBe('t1')
  })

  it('removes an aborted waiter without consuming a slot', async () => {
    const sem = new ProviderSemaphore({ limit: 1 })
    const controller = new AbortController()
    const waiter = sem.run(async () => {}, controller.signal).catch(() => 'aborted')
    const stats1 = sem.stats()
    expect(stats1.queued).toBe(1)
    controller.abort()
    expect(await waiter).toBe('aborted')
    const stats2 = sem.stats()
    expect(stats2.queued).toBe(0)
    expect(stats2.active).toBe(0)
  })
})
```

- [ ] **Step 4: 删除旧文件**

```bash
cd d:/TraeProject/AI-DevSpace
rm apps/agent/src/error/CircuitBreaker.ts
rm apps/agent/src/__tests__/CircuitBreaker.test.ts
```

- [ ] **Step 5: 改 `ClaudeCodeProvider.ts` 的 import + 实例化**

在 `apps/agent/src/providers/ClaudeCodeProvider.ts` 中:
- 找 `import { CircuitBreaker } from '../error/CircuitBreaker.js'` → 改为 `import { ProviderSemaphore } from '../error/ProviderSemaphore.js'`
- 找 `new CircuitBreaker(` → 改为 `new ProviderSemaphore(`

- [ ] **Step 6: 改 `AISession.ts` 的 import + DI 字段**

在 `apps/agent/src/session/AISession.ts` 中:
- 找 `import { CircuitBreaker }` → 改为 `import { ProviderSemaphore }`
- 找 `CircuitBreaker` 类型/字段(可能在 DI 注入签名或私有字段)→ 改为 `ProviderSemaphore`

- [ ] **Step 7: 改 `server.ts` 的 import + 实例化**

在 `apps/agent/src/server.ts` 中:
- 找 `import { CircuitBreaker } from './error/CircuitBreaker.js'` → 改为 `import { ProviderSemaphore } from './error/ProviderSemaphore.js'`
- 找 `new CircuitBreaker(` → 改为 `new ProviderSemaphore(`

- [ ] **Step 8: 检查 e2e 测试是否引用 CircuitBreaker**

```bash
cd d:/TraeProject/AI-DevSpace
grep -rn "CircuitBreaker" apps/ packages/ --include="*.ts" --include="*.tsx"
```

Expected: **0 命中**。若有,继续改完。

- [ ] **Step 9: 跑 Agent 单测确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/ProviderSemaphore.test.ts
```

Expected:
```
✓ src/__tests__/ProviderSemaphore.test.ts (3 tests) PASSED
```

- [ ] **Step 10: 类型检查**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
```

Expected: exit 0,无报错。

- [ ] **Step 11: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add apps/agent/src/error/ProviderSemaphore.ts apps/agent/src/__tests__/ProviderSemaphore.test.ts
git rm apps/agent/src/error/CircuitBreaker.ts apps/agent/src/__tests__/CircuitBreaker.test.ts
git add apps/agent/src/providers/ClaudeCodeProvider.ts apps/agent/src/session/AISession.ts apps/agent/src/server.ts
git commit -m "refactor(agent): rename CircuitBreaker to ProviderSemaphore"
```

---

## Task 2: RetryStrategy 加 `initialDelayMs` 参数

**Files:**
- Modify: `apps/agent/src/error/RetryStrategy.ts`
- Modify: `apps/agent/src/__tests__/RetryStrategy.test.ts`

**Interfaces:**
- Consumes: 现有 `executeWithRetry<T>(operation, options)` 签名
- Produces: 新签名 `executeWithRetry<T>(operation, { initialDelayMs?: number, ... })`,默认 1000;retry 路径调用方传 0

- [ ] **Step 1: 写失败的测试(覆盖 `initialDelayMs=0` 时首 retry 不等 1s)**

在 `apps/agent/src/__tests__/RetryStrategy.test.ts` 末尾追加:

```ts
import { executeWithRetry } from '../error/RetryStrategy.js'
// ... 既有 imports

describe('executeWithRetry · initialDelayMs', () => {
  it('uses initialDelayMs=0 to skip first retry delay', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms)
    })
    let attempts = 0
    await expect(
      executeWithRetry(
        async () => {
          attempts++
          if (attempts < 2) throw new Error('boom')
          throw new Error('still bad')
        },
        {
          sleep: sleep as never,
          initialDelayMs: 0,
          canRetry: () => true,
        },
      ),
    ).rejects.toThrow()
    expect(delays[0]).toBe(0)
  })

  it('defaults initialDelayMs to 1000 (existing behavior unchanged)', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms)
    })
    let attempts = 0
    await expect(
      executeWithRetry(
        async () => {
          attempts++
          if (attempts < 2) throw new Error('boom')
          throw new Error('still bad')
        },
        { sleep: sleep as never, canRetry: () => true },
      ),
    ).rejects.toThrow()
    expect(delays[0]).toBe(1000)
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/RetryStrategy.test.ts
```

Expected: `initialDelayMs=0` 测试 FAIL,报「initialDelayMs is not a property」或类似。

- [ ] **Step 3: 改 `RetryStrategy.ts` 加 `initialDelayMs` 入参**

修改 `apps/agent/src/error/RetryStrategy.ts`:

```ts
// 替换 ExecuteWithRetryOptions interface:
export interface ExecuteWithRetryOptions {
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  onRetry?: (event: RetryEvent) => void | Promise<void>
  canRetry?: (error: unknown, classification: ClassifiedError) => boolean
  /** Override first retry delay (ms). Default 1000. Set 0 for retry-of-retry. */
  initialDelayMs?: number
}
```

在 `executeWithRetry` 函数体内,找到 `const schedule = ...` 之后,添加:

```ts
const initialDelay = options.initialDelayMs ?? 1000
```

替换:

```ts
const delayMs = schedule[retry - 1]
```

为:

```ts
const delayMs = retry === 1 ? initialDelay : schedule[retry - 1]
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/RetryStrategy.test.ts
```

Expected: 全 7 个测试通过(原有 5 + 新 2)。

- [ ] **Step 5: 类型检查**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
```

Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add apps/agent/src/error/RetryStrategy.ts apps/agent/src/__tests__/RetryStrategy.test.ts
git commit -m "feat(agent): add initialDelayMs option to executeWithRetry"
```

---

## Task 3: AISession 写 `last_input` + 加 `isRetry` 入参

**Files:**
- Modify: `apps/agent/src/session/AISession.ts`
- Modify: `apps/agent/src/__tests__/AISession.test.ts`

**Interfaces:**
- Consumes: `runTurn(input: { inputText, signal, appendSystemPrompt? })`
- Produces: `runTurn(input: { inputText, signal, appendSystemPrompt?, isRetry?: boolean })`;`isRetry=true` 时 `executeWithRetry` 传 `initialDelayMs: 0`

- [ ] **Step 1: 先看 AISession 现有 runTurn 实现**

```bash
cd d:/TraeProject/AI-DevSpace
sed -n '40,80p' apps/agent/src/session/AISession.ts
sed -n '320,420p' apps/agent/src/session/AISession.ts
```

读懂 `runTurn` 签名、`#runTurn` 私有方法、`executeWithRetry` 调用点。

- [ ] **Step 2: 写失败测试(`last_input` 持久化)**

在 `apps/agent/src/__tests__/AISession.test.ts` 末尾追加:

```ts
describe('AISession · last_input persistence', () => {
  it('writes inputText to meta.yaml after send', async () => {
    const session = new AISession({ ... }) // 复用既有的 minimal 构造
    await session.send('hello world')
    await someWaitForFlush() // 或 events drain
    const meta = await store.readMeta(reqId, session.localSid)
    expect(meta.last_input).toBe('hello world')
  })
})
```

(具体 store/session 构造细节参考同文件已有 describe 的 setup;若 store 未注入 session,先扩展 AISession 构造以接收 store。)

- [ ] **Step 3: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/AISession.test.ts -t "last_input"
```

Expected: FAIL(类没有 last_input 写入)。

- [ ] **Step 4: AISession 加 `isRetry` 入参 + 写 `last_input`**

修改 `apps/agent/src/session/AISession.ts`:

a) `runTurn` 入参 interface 加 `isRetry?: boolean`:

```ts
runTurn(input: {
  inputText: string
  signal?: AbortSignal
  appendSystemPrompt?: string
  isRetry?: boolean   // ← 新增
}): Promise<void>
```

b) `#runTurn` 内部,找到 `executeWithRetry(operation, { ... })` 调用点,加 `initialDelayMs: input.isRetry ? 0 : 1000`:

```ts
await executeWithRetry(
  async () => { ... },
  {
    signal: controller.signal,
    onRetry: ...,
    initialDelayMs: input.isRetry ? 0 : 1000,  // ← 新增
  },
)
```

c) 在 send 成功路径(`status === 'succeeded'` 处),调 `sessionStore.updateSession(this.#localSid, { last_input: text })`(参考 server.ts:155 的 `last_cancel_at` 写入模式)。

- [ ] **Step 5: AISession 构造加 sessionStore 注入**

若 AISession 构造未接收 store:

a) interface 加 `sessionStore?: SessionStore`
b) `#runTurn` 成功后调用 store
c) server.ts 在 new AISession(...) 时注入 store

- [ ] **Step 6: 写第二个失败测试(`isRetry=true` 时首 retry 间隔=0)**

在 AISession.test.ts 追加:

```ts
describe('AISession · isRetry', () => {
  it('passes initialDelayMs=0 to executeWithRetry when isRetry=true', async () => {
    const delays: number[] = []
    const onRetry = vi.fn()
    // 注入 mock executeWithRetry 或 spy on it
    // ... 验证 delays[0] === 0
  })
})
```

具体 spy 方式:在 AISession.ts 把 `executeWithRetry` 导入并允许 vitest `vi.mock` 替换,或在 AISession 内部用 spy-able 引用。

- [ ] **Step 7: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/AISession.test.ts
```

Expected: 全 AISession 测试通过(含新 2 个)。

- [ ] **Step 8: 类型检查 + Commit**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
git add apps/agent/src/session/AISession.ts apps/agent/src/__tests__/AISession.test.ts apps/agent/src/server.ts
git commit -m "feat(agent): persist last_input and accept isRetry flag in AISession"
```

---

## Task 4: POST /sessions/:sid/retry route

**Files:**
- Create: `apps/agent/src/routes/sessionsRetryRoute.ts`
- Create: `apps/agent/src/__tests__/sessionsRetryRoute.test.ts`
- Modify: `apps/agent/src/server.ts`(注册 route)

**Interfaces:**
- Consumes: `SessionStore.getSession(localSid)`、`AISession.runTurn({ inputText, signal, isRetry: true })`
- Produces: Fastify route `POST /sessions/:localSid/retry`,200/404/409 三态

- [ ] **Step 1: 写失败测试(409 路径优先)**

Create `apps/agent/src/__tests__/sessionsRetryRoute.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { sessionsRetryRoutes } from '../routes/sessionsRetryRoute.js'
import { SessionStore } from '../session/SessionStore.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('POST /sessions/:localSid/retry', () => {
  let root: string
  let store: SessionStore
  let mockRunTurn: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'retry-test-'))
    store = new SessionStore({ root })
    mockRunTurn = vi.fn().mockResolvedValue({ runId: 'r-1' })
  })

  it('returns 404 when session does not exist', async () => {
    const app = Fastify()
    await app.register(sessionsRetryRoutes, { sessionStore: store, runTurn: mockRunTurn })
    const res = await app.inject({ method: 'POST', url: '/sessions/nope/retry', payload: { reqId: 'r' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('session_not_found')
  })

  it('returns 409 when last_input is missing', async () => {
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    const app = Fastify()
    await app.register(sessionsRetryRoutes, { sessionStore: store, runTurn: mockRunTurn })
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${meta.sid}/retry`,
      payload: { reqId: 'REQ-1' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('no_retryable_input')
    expect(mockRunTurn).not.toHaveBeenCalled()
  })

  it('returns 200 and calls runTurn with isRetry=true when last_input exists', async () => {
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    await store.updateSession(meta.sid, { last_input: 'hi' })
    const app = Fastify()
    await app.register(sessionsRetryRoutes, { sessionStore: store, runTurn: mockRunTurn })
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${meta.sid}/retry`,
      payload: { reqId: 'REQ-1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().retryToken).toBeTruthy()
    expect(mockRunTurn).toHaveBeenCalledWith(expect.objectContaining({
      inputText: 'hi',
      isRetry: true,
    }))
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/sessionsRetryRoute.test.ts
```

Expected: FAIL(模块找不到)。

- [ ] **Step 3: 实现 route**

Create `apps/agent/src/routes/sessionsRetryRoute.ts`:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { SessionStore } from '../session/SessionStore.js'

export interface SessionsRetryRoutesOptions {
  sessionStore: SessionStore
  runTurn: (input: { inputText: string; signal?: AbortSignal; isRetry?: boolean }) => Promise<{ runId: string }>
}

export const sessionsRetryRoutes: FastifyPluginAsync<SessionsRetryRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { sessionStore, runTurn } = opts

  app.post<{ Params: { localSid: string }; Body: { reqId: string; runId?: string } }>(
    '/sessions/:localSid/retry',
    async (req, reply) => {
      const { localSid } = req.params
      const meta = await sessionStore.getSession(localSid).catch(() => null)
      if (!meta) {
        return reply.code(404).send({ error: 'session_not_found', message: `Session ${localSid} not found` })
      }
      if (!meta.last_input) {
        return reply.code(409).send({ error: 'no_retryable_input', message: 'No previous input recorded for this session' })
      }
      const controller = new AbortController()
      const result = await runTurn({
        inputText: meta.last_input,
        signal: controller.signal,
        isRetry: true,
      })
      return reply.code(200).send({
        retryToken: `retry-${Date.now()}-${localSid}`,
        runId: result.runId,
      })
    },
  )
}
```

- [ ] **Step 4: 在 `server.ts` 注册 route**

在 `apps/agent/src/server.ts` 找到 buildServer 函数内,加:

```ts
import { sessionsRetryRoutes } from './routes/sessionsRetryRoute.js'
// ...

await app.register(sessionsRetryRoutes, {
  sessionStore,
  runTurn: (input) => {
    const session = /* 你的方式获取 AISession 实例 */;
    return session.runTurn(input).then(() => ({ runId: 'r-' + Date.now() }))
  },
})
```

(具体获取 AISession 实例方式参考 server.ts 中既有 AISession 的实例化模式。)

- [ ] **Step 5: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/sessionsRetryRoute.test.ts
```

Expected: 3 个测试全绿。

- [ ] **Step 6: 类型检查 + Commit**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
git add apps/agent/src/routes/sessionsRetryRoute.ts apps/agent/src/__tests__/sessionsRetryRoute.test.ts apps/agent/src/server.ts
git commit -m "feat(agent): add POST /sessions/:sid/retry route"
```

---

## Task 5: Shared `query_succeeded` SSE 变体

**Files:**
- Modify: `packages/shared/src/sse.ts`

**Interfaces:**
- Consumes: 现有 `SseEvent` discriminated union
- Produces: 新变体 `{ type: 'query_succeeded', reqId, sessionId, runId, ts, durationMs, attempts }`

- [ ] **Step 1: 在 `sse.ts` 找到 query_failed 变体的位置**

```bash
cd d:/TraeProject/AI-DevSpace
grep -n "query_failed" packages/shared/src/sse.ts
```

读上下文,在 `query_failed` 之后追加新变体。

- [ ] **Step 2: 加 `query_succeeded` 变体**

修改 `packages/shared/src/sse.ts`,在 `query_failed` 变体后追加:

```ts
  /**
   * Query 成功终态(issue P4 · Task 5)— query 正常结束时广播。
   * Web 端 reducer 据此把 status 从 running/retrying 重置为 idle。
   */
  | {
      type: 'query_succeeded'
      reqId: string
      sessionId: string
      runId: string
      ts: number
      durationMs: number
      attempts: number
    }
```

- [ ] **Step 3: 找 AISession 既有 SSE emit `done{reason:'end_turn'}` 处,同步加 query_succeeded**

在 `apps/agent/src/session/AISession.ts` 中,找 `this.#push({ type: 'done', reason: 'end_turn', ... })` 处,在它前面加:

```ts
this.#push({
  type: 'query_succeeded',
  reqId,
  sessionId: this.#sdkSessionId,
  runId: this.#runId,
  ts: Date.now(),
  durationMs: Date.now() - this.#turnStartedAt,
  attempts: this.#lastAttempts,
})
```

(具体字段名以 AISession 现有实现为准;若 #runId / #turnStartedAt / #lastAttempts 不存在,先在 runTurn 起手处记录。)

- [ ] **Step 4: 跑 shared 类型检查**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
```

Expected: exit 0。

- [ ] **Step 5: 跑 Agent 单测**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add packages/shared/src/sse.ts apps/agent/src/session/AISession.ts
git commit -m "feat(shared): add query_succeeded SSE event variant"
```

---

## Task 6: `useExecutingSse` hook(TDD)

**Files:**
- Create: `apps/web/src/lib/useExecutingSse.ts`
- Create: `apps/web/src/lib/__tests__/useExecutingSse.test.ts`

**Interfaces:**
- Consumes: `SseEvent` from `@ai-devspace/shared`
- Produces: `ExecutingAiStatus` discriminated union(5 种);hook 返回 `{ status, retry, cancel }`

- [ ] **Step 1: 写失败测试(reducer 纯转换)**

Create `apps/web/src/lib/__tests__/useExecutingSse.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExecutingSse } from '../useExecutingSse'

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}
globalThis.EventSource = MockEventSource as never

describe('useExecutingSse', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in idle and does not connect when sessionId is null', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: null, enabled: true }),
    )
    expect(result.current.status).toEqual({ kind: 'idle' })
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('connects to EventSource when sessionId provided', () => {
    renderHook(() => useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain('/events?reqId=r1')
  })

  it('transitions idle → retrying on retrying event', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }),
    )
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying',
        reqId: 'r1',
        sessionId: 's1',
        runId: 'run-1',
        ts: Date.now(),
        category: 'A',
        retry: 1,
        maxRetries: 3,
        delayMs: 1000,
        message: 'rate limit',
      })
    })
    expect(result.current.status.kind).toBe('retrying')
    if (result.current.status.kind === 'retrying') {
      expect(result.current.status.retry).toBe(1)
      expect(result.current.status.maxRetries).toBe(3)
    }
  })

  it('transitions retrying → failed on query_failed', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }),
    )
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying',
        reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: '',
      })
      MockEventSource.instances[0].emit({
        type: 'query_failed',
        reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'B', code: '401', message: 'auth failed',
      })
    })
    expect(result.current.status.kind).toBe('failed')
    if (result.current.status.kind === 'failed') {
      expect(result.current.status.category).toBe('B')
      expect(result.current.status.code).toBe('401')
    }
  })

  it('drops events with stale runId', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }),
    )
    // 触发一次 retrying 建立当前 runId=run-1
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying', reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: '',
      })
    })
    // 模拟用户重试,reducer 进入新的 run-2
    // (具体触发方式:先 emit query_succeeded 回到 idle,然后通过 retry() 或外部设)
    // 简化:直接 emit 一个 query_succeeded 把状态重置为 idle,再用 retry() 进入新 run
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'query_succeeded', reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        durationMs: 100, attempts: 1,
      })
    })
    expect(result.current.status.kind).toBe('idle')
    // 此时旧 run-1 的迟到 retrying 事件应被丢弃
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying', reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'A', retry: 2, maxRetries: 3, delayMs: 3000, message: 'late',
      })
    })
    expect(result.current.status.kind).toBe('idle') // 仍是 idle,丢弃了
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/lib/__tests__/useExecutingSse.test.ts
```

Expected: FAIL(模块找不到)。

- [ ] **Step 3: 实现 hook**

Create `apps/web/src/lib/useExecutingSse.ts`:

```ts
'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { SseEvent } from '@ai-devspace/shared'

export type ExecutingAiStatus =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: string }
  | { kind: 'retrying'; category: 'A' | 'C' | 'D'; retry: number; maxRetries: number; delayMs: number; startedAt: string }
  | { kind: 'failed'; category: 'A' | 'B' | 'C' | 'D' | 'E'; code: string; message: string; failedAt: string }
  | { kind: 'cancelled'; reason: string; cancelledAt: string }

export interface UseExecutingSseOptions {
  reqId: string
  sessionId: string | null
  enabled: boolean
}

interface InternalState {
  status: ExecutingAiStatus
  currentRunId: string | null
}

type Action =
  | { type: 'reset'; runId: string | null }
  | { type: 'running'; runId: string; startedAt: string }
  | { type: 'retrying'; runId: string; payload: { category: 'A' | 'C' | 'D'; retry: number; maxRetries: number; delayMs: number } }
  | { type: 'failed'; runId: string; payload: { category: 'A' | 'B' | 'C' | 'D' | 'E'; code: string; message: string }; failedAt: string }
  | { type: 'cancelled'; runId: string; reason: string; cancelledAt: string }

function reducer(state: InternalState, action: Action): InternalState {
  // 旧 runId 事件一律丢弃
  if (state.currentRunId !== null && 'runId' in action && action.runId !== state.currentRunId) {
    return state
  }
  switch (action.type) {
    case 'reset':
      return { status: { kind: 'idle' }, currentRunId: action.runId }
    case 'running':
      return { status: { kind: 'running', startedAt: action.startedAt }, currentRunId: action.runId }
    case 'retrying':
      return {
        status: {
          kind: 'retrying',
          category: action.payload.category,
          retry: action.payload.retry,
          maxRetries: action.payload.maxRetries,
          delayMs: action.payload.delayMs,
          startedAt: state.status.kind === 'running' ? state.status.startedAt : new Date().toISOString(),
        },
        currentRunId: action.runId,
      }
    case 'failed':
      return {
        status: {
          kind: 'failed',
          category: action.payload.category,
          code: action.payload.code,
          message: action.payload.message,
          failedAt: action.failedAt,
        },
        currentRunId: action.runId,
      }
    case 'cancelled':
      return {
        status: { kind: 'cancelled', reason: action.reason, cancelledAt: action.cancelledAt },
        currentRunId: action.runId,
      }
  }
}

export function useExecutingSse(opts: UseExecutingSseOptions) {
  const { reqId, sessionId, enabled } = opts
  const [state, dispatch] = useReducer(reducer, { status: { kind: 'idle' }, currentRunId: null })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled || !sessionId) {
      esRef.current?.close()
      esRef.current = null
      return
    }
    const es = new EventSource(`/api/agent/events?reqId=${encodeURIComponent(reqId)}`)
    esRef.current = es
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent
        switch (event.type) {
          case 'retrying':
            dispatch({
              type: 'retrying',
              runId: event.runId,
              payload: {
                category: event.category,
                retry: event.retry ?? 1,
                maxRetries: event.maxRetries ?? 1,
                delayMs: event.delayMs ?? 0,
              },
            })
            break
          case 'query_failed':
            dispatch({
              type: 'failed',
              runId: event.runId,
              payload: { category: event.category, code: event.code, message: event.message },
              failedAt: new Date().toISOString(),
            })
            break
          case 'query_succeeded':
            dispatch({ type: 'reset', runId: null })
            break
          case 'done':
            if (event.reason === 'cancelled') {
              dispatch({
                type: 'cancelled',
                runId: event.sessionId,
                reason: 'user',
                cancelledAt: new Date().toISOString(),
              })
            } else {
              dispatch({ type: 'reset', runId: null })
            }
            break
        }
      } catch {
        /* malformed event */
      }
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [enabled, sessionId, reqId])

  const retry = useCallback(async () => {
    if (!sessionId) throw new Error('No sessionId')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reqId }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`retry failed: ${res.status}`)
      const data = await res.json()
      dispatch({ type: 'running', runId: data.runId, startedAt: new Date().toISOString() })
    } finally {
      clearTimeout(timeout)
    }
  }, [sessionId, reqId])

  const cancel = useCallback(async () => {
    // 本期 no-op
  }, [])

  return { status: state.status, retry, cancel }
}
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/lib/__tests__/useExecutingSse.test.ts
```

Expected: 5 个测试全绿。

- [ ] **Step 5: 类型检查 + Commit**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
git add apps/web/src/lib/useExecutingSse.ts apps/web/src/lib/__tests__/useExecutingSse.test.ts
git commit -m "feat(web): add useExecutingSse hook for SSE subscription"
```

---

## Task 7: Toast + ToastHost 组件(TDD)

**Files:**
- Create: `apps/web/src/components/toast.tsx`
- Create: `apps/web/src/components/toast-host.tsx`
- Create: `apps/web/src/components/__tests__/toast.test.tsx`
- Create: `apps/web/src/components/__tests__/toast-host.test.tsx`

**Interfaces:**
- Consumes: 无外部依赖
- Produces:
  - `ToastItem { id, message, tone, durationMs }`
  - `<Toast item onDismiss />` 组件
  - `<ToastHost items onDismiss />` 容器

- [ ] **Step 1: 写 Toast 失败测试**

Create `apps/web/src/components/__tests__/toast.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast } from '../toast'
import type { ToastItem } from '../toast'

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('renders message and tone class', () => {
    const item: ToastItem = { id: '1', message: 'hello', tone: 'warn', durationMs: 3000 }
    render(<Toast item={item} onDismiss={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByTestId('toast-1')).toHaveAttribute('data-tone', 'warn')
  })

  it('calls onDismiss after durationMs', () => {
    const onDismiss = vi.fn()
    const item: ToastItem = { id: '1', message: 'hi', tone: 'info', durationMs: 3000 }
    render(<Toast item={item} onDismiss={onDismiss} />)
    vi.advanceTimersByTime(3000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not auto-dismiss when durationMs is null', () => {
    const onDismiss = vi.fn()
    const item: ToastItem = { id: '1', message: 'sticky', tone: 'err', durationMs: null }
    render(<Toast item={item} onDismiss={onDismiss} />)
    vi.advanceTimersByTime(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('clicking close button calls onDismiss immediately', () => {
    const onDismiss = vi.fn()
    const item: ToastItem = { id: '1', message: 'hi', tone: 'info', durationMs: 5000 }
    render(<Toast item={item} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('关闭通知'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/components/__tests__/toast.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现 Toast 组件**

Create `apps/web/src/components/toast.tsx`:

```tsx
'use client'

import { useEffect } from 'react'

export interface ToastItem {
  id: string
  message: string
  tone: 'info' | 'warn' | 'err'
  /** null = 不自动消失(用户手动关) */
  durationMs: number | null
}

const TONE_CLASS: Record<ToastItem['tone'], string> = {
  info: 'bg-brand-50 text-brand-700 border-brand',
  warn: 'bg-[#fef3c7] text-[#92400e] border-[#92400e]',
  err: 'bg-[#fee2e2] text-[#991b1b] border-[#991b1b]',
}

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): JSX.Element {
  useEffect(() => {
    if (item.durationMs === null) return
    const t = setTimeout(onDismiss, item.durationMs)
    return () => clearTimeout(t)
  }, [item.durationMs, onDismiss])

  return (
    <div
      data-testid={`toast-${item.id}`}
      data-tone={item.tone}
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 px-4 py-2 rounded-md border shadow-sm ${TONE_CLASS[item.tone]}`}
    >
      <span className="text-sm flex-1">{item.message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={onDismiss}
        className="text-current opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 跑 Toast 测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/components/__tests__/toast.test.tsx
```

Expected: 4 个测试全绿。

- [ ] **Step 5: 写 ToastHost 失败测试**

Create `apps/web/src/components/__tests__/toast-host.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToastHost } from '../toast-host'
import type { ToastItem } from '../toast'

describe('ToastHost', () => {
  it('renders all items stacked', () => {
    const items: ToastItem[] = [
      { id: '1', message: 'first', tone: 'info', durationMs: 3000 },
      { id: '2', message: 'second', tone: 'warn', durationMs: 3000 },
    ]
    render(<ToastHost items={items} onDismiss={() => {}} />)
    expect(screen.getByTestId('toast-1')).toBeInTheDocument()
    expect(screen.getByTestId('toast-2')).toBeInTheDocument()
  })

  it('calls onDismiss with id when child toast dismissed', () => {
    const onDismiss = vi.fn()
    const items: ToastItem[] = [{ id: 'x', message: 'm', tone: 'info', durationMs: 3000 }]
    render(<ToastHost items={items} onDismiss={onDismiss} />)
    screen.getByLabelText('关闭通知').click()
    expect(onDismiss).toHaveBeenCalledWith('x')
  })

  it('renders empty container when no items', () => {
    const { container } = render(<ToastHost items={[]} onDismiss={() => {}} />)
    expect(container.querySelector('[data-testid="toast-host"]')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: 实现 ToastHost**

Create `apps/web/src/components/toast-host.tsx`:

```tsx
'use client'

import { Toast, type ToastItem } from './toast'

export function ToastHost({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: string) => void
}): JSX.Element {
  return (
    <div
      data-testid="toast-host"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <Toast item={item} onDismiss={() => onDismiss(item.id)} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: 跑 ToastHost 测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/components/__tests__/toast-host.test.tsx
```

Expected: 3 个测试全绿。

- [ ] **Step 8: 类型检查 + Commit**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
git add apps/web/src/components/toast.tsx apps/web/src/components/toast-host.tsx apps/web/src/components/__tests__/toast.test.tsx apps/web/src/components/__tests__/toast-host.test.tsx
git commit -m "feat(web): add Toast and ToastHost components"
```

---

## Task 8: EXECUTING StageStrip 加 status 徽章

**Files:**
- Modify: `apps/web/src/components/executing-zone.tsx`(StageStrip 函数签名 + 渲染)
- Modify: `apps/web/src/__tests__/executing-zone.test.tsx`(加 4 个 status 用例)
- Modify: `apps/web/src/lib/executing.ts`(`ExecutingData` 加 `sessionId?` / `reqId?`)

**Interfaces:**
- Consumes: `ExecutingAiStatus` from `useExecutingSse`
- Produces: `StageStrip({ stage, status })`;徽章 testid `executing-stage-status` + `data-status={status.kind}`

- [ ] **Step 1: 改 `ExecutingData` 加可选字段**

在 `apps/web/src/lib/executing.ts` 找到 `export interface ExecutingData`,在末尾加:

```ts
  // 本期新增:
  sessionId?: string | null
  reqId?: string
```

- [ ] **Step 2: 写 StageStrip 徽章失败测试**

在 `apps/web/src/__tests__/executing-zone.test.tsx` 追加 describe:

```tsx
describe('ExecutingZone · StageStrip status badge', () => {
  it.each<[ExecutingAiStatus['kind'], string]>([
    ['retrying', 'executing-stage-status'],
    ['failed', 'executing-stage-status'],
    ['cancelled', 'executing-stage-status'],
  ])('renders badge for status=%s', (kind, testid) => {
    const status: ExecutingAiStatus = { kind, ...mockStatusByKind(kind) } as never
    const { container } = render(<ExecutingZone data={buildExecutingData({ status })} />)
    expect(container.querySelector(`[data-testid="${testid}"]`)).toHaveAttribute('data-status', kind)
  })

  it('renders no badge when status=idle', () => {
    const { container } = render(
      <ExecutingZone data={buildExecutingData({ status: { kind: 'idle' } })} />,
    )
    expect(container.querySelector('[data-testid="executing-stage-status"]')).toBeNull()
  })
})
```

(具体 `mockStatusByKind` / `buildExecutingData` helper 参考该文件既有的 `buildExecutingData` 工厂函数;若不存在则新建一个 factory。)

- [ ] **Step 3: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "StageStrip status badge"
```

Expected: FAIL。

- [ ] **Step 4: 改 `executing-zone.tsx` 的 StageStrip**

修改 `apps/web/src/components/executing-zone.tsx`:

a) import 加 `ExecutingAiStatus`:

```ts
import { useExecutingSse, type ExecutingAiStatus } from '@/lib/useExecutingSse'
```

b) StageStrip 函数签名改:

```ts
function StageStrip({ stage, status }: { stage: StageData; status: ExecutingAiStatus }): JSX.Element {
  return (
    <div data-testid="executing-stage-strip" className="...">
      {/* 既有徽章 + 标题 + meta */}
      <div className="flex items-center gap-2 ...">
        {/* 既有 badge + title */}
      </div>
      <StatusBadge status={status} />
    </div>
  )
}

function StatusBadge({ status }: { status: ExecutingAiStatus }): JSX.Element | null {
  if (status.kind === 'idle' || status.kind === 'running') return null
  if (status.kind === 'retrying') {
    return (
      <span
        data-testid="executing-stage-status"
        data-status="retrying"
        className="bg-[#fef3c7] text-[#92400e] text-xs font-medium px-2 py-0.5 rounded animate-pulse"
      >
        ⚠️ 重试中 {status.retry}/{status.maxRetries}({status.category})
      </span>
    )
  }
  if (status.kind === 'failed') {
    return (
      <span
        data-testid="executing-stage-status"
        data-status="failed"
        className="bg-[#fee2e2] text-[#991b1b] text-xs font-medium px-2 py-0.5 rounded"
      >
        ❌ 失败 · {status.category} · {status.code}
      </span>
    )
  }
  if (status.kind === 'cancelled') {
    return (
      <span
        data-testid="executing-stage-status"
        data-status="cancelled"
        className="bg-bg-subtle text-text-3 text-xs font-medium px-2 py-0.5 rounded"
      >
        ⏸ 已停止
      </span>
    )
  }
  return null
}
```

c) ExecutingZone 函数签名暂时不变(先测试 StageStrip 单独可测)。

- [ ] **Step 5: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "StageStrip status badge"
```

Expected: 4 个测试全绿。

- [ ] **Step 6: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add apps/web/src/components/executing-zone.tsx apps/web/src/__tests__/executing-zone.test.tsx apps/web/src/lib/executing.ts
git commit -m "feat(web): add StageStrip status badge to EXECUTING"
```

---

## Task 9: EXECUTING Toolbar 加重试按钮

**Files:**
- Modify: `apps/web/src/components/executing-zone.tsx`(Toolbar 函数)
- Modify: `apps/web/src/__tests__/executing-zone.test.tsx`(加显隐用例)

**Interfaces:**
- Consumes: `onRetry: () => void`、`canRetry: boolean`
- Produces: `Toolbar({ toolbar, onRetry, canRetry })`;重试按钮 testid `executing-toolbar-retry`

- [ ] **Step 1: 写失败测试(显隐 + click 调用)**

在 executing-zone.test.tsx 追加:

```tsx
describe('ExecutingZone · Toolbar retry button', () => {
  it('shows retry button only when canRetry=true', () => {
    const { rerender } = render(
      <ExecutingZone data={buildExecutingData({ status: { kind: 'running', startedAt: '' } })} />,
    )
    expect(screen.queryByTestId('executing-toolbar-retry')).toBeNull()

    rerender(
      <ExecutingZone
        data={buildExecutingData({
          status: { kind: 'failed', category: 'B', code: '401', message: '', failedAt: '' },
        })}
      />,
    )
    expect(screen.getByTestId('executing-toolbar-retry')).toBeInTheDocument()
  })

  it('clicking retry button triggers onRetry', async () => {
    const onRetry = vi.fn()
    render(
      <ExecutingZone
        data={buildExecutingData({
          status: { kind: 'failed', category: 'B', code: '401', message: '', failedAt: '' },
          onRetry,
        })}
      />,
    )
    await userEvent.click(screen.getByTestId('executing-toolbar-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "Toolbar retry button"
```

Expected: FAIL。

- [ ] **Step 3: 改 Toolbar**

修改 `apps/web/src/components/executing-zone.tsx` 的 Toolbar 函数:

```ts
function Toolbar({
  toolbar,
  onRetry,
  canRetry,
}: {
  toolbar: ToolbarData
  onRetry: () => void
  canRetry: boolean
}): JSX.Element {
  const actions = canRetry
    ? [{ variant: 'danger' as const, label: '🔄 重试', onClick: onRetry }, ...toolbar.actions]
    : toolbar.actions
  return (
    <div data-testid="executing-toolbar" className="...">
      <ToolbarCrumbView crumb={toolbar.crumb} />
      <div className="flex gap-2">
        {actions.map((a, i) => (
          <ToolbarActionButton key={`${a.label}-${i}`} action={a} />
        ))}
        {canRetry && (
          <button
            type="button"
            data-testid="executing-toolbar-retry"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-bg-elevated text-error border border-error hover:bg-[#fef2f2]"
          >
            🔄 重试
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "Toolbar retry button"
```

Expected: 2 个测试全绿。

- [ ] **Step 5: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add apps/web/src/components/executing-zone.tsx apps/web/src/__tests__/executing-zone.test.tsx
git commit -m "feat(web): add retry button to EXECUTING Toolbar"
```

---

## Task 10: EXECUTING AIEventColumn 加 cancelled marker

**Files:**
- Modify: `apps/web/src/components/executing-zone.tsx`(AIEventColumn 函数)
- Modify: `apps/web/src/__tests__/executing-zone.test.tsx`(加 marker 用例)

**Interfaces:**
- Consumes: `cancelledAt: string | null`(ISO 时间戳)
- Produces: AIEventColumn 末尾追加 marker 行;testid `executing-ai-event-cancelled-marker`

- [ ] **Step 1: 写失败测试**

在 executing-zone.test.tsx 追加:

```tsx
describe('ExecutingZone · AIEventColumn cancelled marker', () => {
  it('appends cancelled marker when cancelledAt is set', () => {
    const { container } = render(
      <ExecutingZone
        data={buildExecutingData({
          status: { kind: 'cancelled', reason: 'user', cancelledAt: '14:23:05' },
          aiEvents: [],
        })}
      />,
    )
    const marker = container.querySelector('[data-testid="executing-ai-event-cancelled-marker"]')
    expect(marker).toBeInTheDocument()
    expect(marker).toHaveAttribute('data-tone', 'warn')
    expect(marker?.textContent).toContain('已停止')
    expect(marker?.textContent).toContain('14:23:05')
  })

  it('does not render marker when cancelledAt is null', () => {
    const { container } = render(
      <ExecutingZone data={buildExecutingData({ status: { kind: 'idle' }, aiEvents: [] })} />,
    )
    expect(container.querySelector('[data-testid="executing-ai-event-cancelled-marker"]')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "cancelled marker"
```

Expected: FAIL。

- [ ] **Step 3: 改 AIEventColumn**

修改 `apps/web/src/components/executing-zone.tsx` 的 AIEventColumn 函数:

```ts
function AIEventColumn({
  events,
  cancelledAt,
}: {
  events: AIEvent[]
  cancelledAt: string | null
}): JSX.Element {
  return (
    <aside data-testid="executing-ai-col" className="...">
      <header>...</header>
      {events.length === 0 && cancelledAt === null ? (
        <p className="text-text-3 text-sm">暂无 AI 事件</p>
      ) : (
        <>
          {events.map((e) => <AIEventCard key={e.id} event={e} />)}
          {cancelledAt !== null && (
            <article
              data-testid="executing-ai-event-cancelled-marker"
              data-tone="warn"
              className="bg-bg-subtle rounded-md p-3 text-sm border-l-[3px] border-l-warning"
            >
              <div className="font-mono text-xs text-text-3 mb-0.5">{cancelledAt}</div>
              <div className="font-medium text-text-1 flex items-center gap-1.5">
                ⏸ 已停止
              </div>
            </article>
          )}
        </>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "cancelled marker"
```

Expected: 2 个测试全绿。

- [ ] **Step 5: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add apps/web/src/components/executing-zone.tsx apps/web/src/__tests__/executing-zone.test.tsx
git commit -m "feat(web): add cancelled marker to EXECUTING AIEventColumn"
```

---

## Task 11: EXECUTING 顶层接线(useExecutingSse + Toast)

**Files:**
- Modify: `apps/web/src/components/executing-zone.tsx`(ExecutingZone 函数)
- Modify: `apps/web/src/__tests__/executing-zone.test.tsx`(端到端接线用例)

**Interfaces:**
- Consumes: `ExecutingData` 中的 `sessionId`/`reqId`
- Produces: ExecutingZone 调用 `useExecutingSse`,管理 toasts state,渲染 ToastHost

- [ ] **Step 1: 写失败测试(retrying 时 toast 自动出现)**

在 executing-zone.test.tsx 追加:

```tsx
describe('ExecutingZone · top-level wiring', () => {
  it('pops toast when status transitions to retrying', () => {
    const { rerender } = render(
      <ExecutingZone data={buildExecutingData({ status: { kind: 'running', startedAt: '' } })} />,
    )
    expect(screen.queryByText(/连接异常,重试中/)).toBeNull()

    rerender(
      <ExecutingZone
        data={buildExecutingData({
          status: {
            kind: 'retrying',
            category: 'A',
            retry: 1,
            maxRetries: 3,
            delayMs: 1000,
            startedAt: '',
          },
        })}
      />,
    )
    expect(screen.getByText(/连接异常,重试中 1\/3/)).toBeInTheDocument()
  })

  it('pops err toast when retry fails', async () => {
    const failingRetry = vi.fn().mockRejectedValue(new Error('network'))
    render(
      <ExecutingZone
        data={buildExecutingData({
          status: { kind: 'failed', category: 'B', code: '401', message: '', failedAt: '' },
          onRetry: failingRetry,
        })}
      />,
    )
    await userEvent.click(screen.getByTestId('executing-toolbar-retry'))
    expect(await screen.findByText(/重试请求失败/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx -t "top-level wiring"
```

Expected: FAIL。

- [ ] **Step 3: 改 ExecutingZone 顶层接线**

修改 `apps/web/src/components/executing-zone.tsx` 的 ExecutingZone 函数:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useExecutingSse, type ExecutingAiStatus } from '@/lib/useExecutingSse'
import { ToastHost, type ToastItem } from './toast-host'

export function ExecutingZone({ data }: { data: ExecutingData }): JSX.Element {
  if (data.empty) {
    return <main data-testid="executing-zone" data-empty="true" className="..."><EmptyExecuting data={data} /></main>
  }

  const sessionId = data.sessionId ?? null
  const reqId = data.reqId ?? data.requirementId
  const { status, retry } = useExecutingSse({ reqId, sessionId, enabled: true })
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // status 变化时推 toast(retrying 进入)
  useEffect(() => {
    if (status.kind === 'retrying') {
      setToasts((cur) => [
        ...cur,
        {
          id: crypto.randomUUID(),
          message: `⚠️ 连接异常,重试中 ${status.retry}/${status.maxRetries}`,
          tone: 'warn',
          durationMs: 3000,
        },
      ])
    }
  }, [status])

  // 重试按钮包装:失败时 push err toast
  const handleRetry = useCallback(async () => {
    try {
      await retry()
    } catch (err) {
      setToasts((cur) => [
        ...cur,
        {
          id: crypto.randomUUID(),
          message: `❌ 重试请求失败:${err instanceof Error ? err.message : String(err)}`,
          tone: 'err',
          durationMs: 5000,
        },
      ])
    }
  }, [retry])

  return (
    <main data-testid="executing-zone" data-empty="false" className="...">
      <StageStrip stage={data.stage} status={status} />
      <Toolbar toolbar={data.toolbar} onRetry={handleRetry} canRetry={status.kind === 'failed'} />
      <div data-testid="executing-mc-main" className="grid grid-cols-[280px_1fr_320px] flex-1 min-h-0 border-t border-border">
        <DagColumn tasks={data.dag.tasks} block={data.dag.block} />
        <DiffColumn diff={data.diff} />
        <AIEventColumn
          events={data.aiEvents}
          cancelledAt={status.kind === 'cancelled' ? status.cancelledAt : null}
        />
      </div>
      <ToastHost items={toasts} onDismiss={(id) => setToasts((cur) => cur.filter((t) => t.id !== id))} />
    </main>
  )
}
```

注意:StageStrip/Toolbar/AIEventColumn 调用签名需匹配 Task 8/9/10 的修改(传 `status`、`onRetry`/`canRetry`、`cancelledAt`)。

- [ ] **Step 4: 跑测试确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/web
npx vitest run src/__tests__/executing-zone.test.tsx
```

Expected: 全部 EXECUTING 测试通过(既有 + 新增 ~10 个)。

- [ ] **Step 5: 类型检查 + Commit**

```bash
cd d:/TraeProject/AI-DevSpace
pnpm tsc --noEmit
git add apps/web/src/components/executing-zone.tsx apps/web/src/__tests__/executing-zone.test.tsx
git commit -m "feat(web): wire useExecutingSse + Toast into EXECUTING top-level"
```

---

## Task 12: e2e 验收 + issue 文档同步

**Files:**
- Modify: `apps/agent/src/__tests__/agent-skeleton.e2e.test.ts`(扩 retrying/query_failed/retry 用例)
- Modify: `.scratch/feature/sdk-integration/issues/05-p4-errors.md`(checkbox 勾选 + 验收 section 重写)

**Interfaces:**
- Consumes: 完整 Agent + Web 链路
- Produces: e2e 跑通;issue 文档同步

- [ ] **Step 1: 写 e2e 失败测试(retrying 事件 → query_failed 事件 → POST /retry → query_succeeded)**

在 `apps/agent/src/__tests__/agent-skeleton.e2e.test.ts` 追加 describe:

```ts
describe('e2e · retrying → query_failed → /retry → query_succeeded', () => {
  it('full flow', async () => {
    // 起 server, mock provider 让前 2 次 query 抛 A 类错,第 3 次抛 B 类永久错
    // 通过 EventSource 订阅
    // 验证:收到 retrying (1/3, 2/3) → query_failed(B)
    // 调用 POST /sessions/:sid/retry
    // mock provider 改成正常返回 → 收到 query_succeeded
  })
})
```

具体 mock provider 设置参考该文件既有 describe 的 mock 模式(可复用既有 helper)。

- [ ] **Step 2: 跑 e2e 确认绿**

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
npx vitest run src/__tests__/agent-skeleton.e2e.test.ts
```

Expected: e2e 全绿。

- [ ] **Step 3: 跑全量测试 + 类型检查**

```bash
cd d:/TraeProject/AI-DevSpace
cd apps/agent && npx vitest run
cd ../web && npx vitest run
cd ..
pnpm tsc --noEmit
```

Expected: 全部绿,exit 0。

- [ ] **Step 4: 改 `.scratch/.../05-p4-errors.md` checkbox**

打开 `.scratch/feature/sdk-integration/issues/05-p4-errors.md`,把所有 `- [ ]` 改为 `- [x]`(本期全部 7 个 checkbox 都已实现)。

- [ ] **Step 5: 重写「验收」section 为 workspace 对齐版**

替换 issue 文件中的「## 验收」section 内容为本计划 spec §1.3 中的验收清单(去掉 markdown 的 checkbox 改为已勾选形态)。

- [ ] **Step 6: Commit**

```bash
cd d:/TraeProject/AI-DevSpace
git add apps/agent/src/__tests__/agent-skeleton.e2e.test.ts .scratch/feature/sdk-integration/issues/05-p4-errors.md
git commit -m "docs(scratch): sync Q8.4 acceptance with workspace-aligned UI

- Add e2e test for retrying → query_failed → /retry → query_succeeded
- Update 05-p4-errors.md checkboxes and acceptance section"
```

- [ ] **Step 7: 最终全量验证**

```bash
cd d:/TraeProject/AI-DevSpace
cd apps/agent && npx vitest run
cd ../web && npx vitest run
cd ..
pnpm tsc --noEmit
git log --oneline -12
```

Expected:
- Agent tests: 全绿
- Web tests: 全绿
- tsc: exit 0
- git log: 12 个新 commits(每个 Task 1 个)

---

## Self-Review

### 1. Spec coverage(逐 section 对照)

| Spec 章节 | 对应 Task |
|---|---|
| §3.1 ProviderSemaphore 重命名 | Task 1 |
| §3.2 sessionsRetryRoute | Task 4 |
| §3.3 AISession.isRetry + last_input + RetryStrategy.initialDelayMs | Task 2 + Task 3 |
| §3.4 Shared query_succeeded | Task 5 |
| §3.5 useExecutingSse(类型 + reducer 表 + 实现要点) | Task 6 |
| §3.6 Toast + ToastHost | Task 7 |
| §3.7 EXECUTING StageStrip | Task 8 |
| §3.7 EXECUTING Toolbar 重试按钮 | Task 9 |
| §3.7 EXECUTING AIEventColumn cancelled marker | Task 10 |
| §3.7 ExecutingZone 顶层接线 | Task 11 |
| §4 数据流时序(集成测试覆盖) | Task 12 |
| §5 测试策略(分层) | Task 1-12 各自的 Step |
| §6 风险与对策 | 全程贯穿 |
| §7 改动文件清单 | 全覆盖 |
| §8 实施顺序 | 12 Task 严格按 8 Step 顺序展开 |

### 2. Placeholder scan

- ❌ "TBD" / "TODO" / "fill in details" / "Similar to Task N":**0**
- ❌ "Add appropriate error handling":**0**(所有 error 路径都有显式 status code / 类型 / 字段)
- ❌ "Write tests for the above" without code:**0**(所有 Task 都有具体测试代码块)
- ⚠️ Task 3 Step 6 的「vi.mock」:已说明可走 vi.mock 替换 executeWithRetry,留小许灵活性
- ⚠️ Task 4 Step 4 的「具体获取 AISession 实例方式」:留小许灵活性,提示参考 server.ts 既有模式
- ⚠️ Task 5 Step 3 的 #runId/#turnStartedAt/#lastAttempts:已在该 Step 提示「若不存在,先在 runTurn 起手处记录」

> **决策**:这三处「弹性」是合理的(避免硬编码到具体 AISession 现有内部字段名,允许执行时根据现状调整);不是 placeholder。

### 3. Type consistency

| 符号 | 定义位置 | 使用位置 | 一致? |
|---|---|---|---|
| `ProviderSemaphore` | Task 1 Step 2 | Task 1 Step 5-7 | ✓ |
| `ProviderSemaphoreStats` | Task 1 Step 2 | n/a | ✓ |
| `initialDelayMs?: number` | Task 2 Step 3(RetryStrategy) | Task 3 Step 4(AISession) | ✓ |
| `isRetry?: boolean` | Task 3 Step 4 | Task 4 Step 3(retry route) | ✓ |
| `ExecutingAiStatus` | Task 6 Step 3 | Task 8/9/10/11 | ✓ |
| `ToastItem` | Task 7 Step 3 | Task 11 + Task 7 Step 5(host) | ✓ |
| `executing-stage-status` testid | Task 8 Step 4 | Task 8 Step 2 测试 | ✓ |
| `executing-toolbar-retry` testid | Task 9 Step 3 | Task 9 Step 1 测试 | ✓ |
| `executing-ai-event-cancelled-marker` testid | Task 10 Step 3 | Task 10 Step 1 测试 | ✓ |
| `toast-${id}` testid | Task 7 Step 3 | Task 7 Step 1 测试 | ✓ |
| `toast-host` testid | Task 7 Step 6 | Task 7 Step 5 测试 | ✓ |

所有类型与 testid 跨 Task 一致。
