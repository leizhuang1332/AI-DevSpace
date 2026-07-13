# P4 Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Claude Agent SDK query 增加 A–E 错误分类、固定退避重试、per-Agent FIFO 并发限制、取消持久化、双层日志和 typed SSE 契约。

**Architecture:** `ClaudeCodeProvider` 继续负责 SDK raw message 和 options 适配，并为所有 session 注入同一个 `CircuitBreaker`。`AiSession` 在一次 turn 生命周期内获取并发 slot、调用 `RetryStrategy`、维护 AbortController 和发出稳定 `AIEvent`；`SessionRecorder` 与 `SessionLogger` 分别持久化消息流和 query 汇总。Fastify route 只负责 session 注册、取消入口和 `AIEvent -> SseEvent` 映射。

**Tech Stack:** TypeScript 5.4、Node.js 20+、Vitest 2、Fastify 5、Pino 9、`@anthropic-ai/claude-agent-sdk` 0.3.206、YAML、pnpm 9 workspace。

## Global Constraints

- 范围只包含 Agent 后端和 typed SSE 契约；不修改 `apps/web`。
- A/D 在初始调用后最多追加 3 次重试，固定延迟精确为 `1000 / 3000 / 10000 ms`；C 只追加 1 次重试。
- B/E/用户取消不重试；未知错误默认归 B。
- 每个 `ClaudeCodeProvider` 同时最多运行 5 个完整 query，超出后严格 FIFO；退避期间继续占用 slot。
- `CircuitBreaker` 名称按 issue 保留，但实现是 concurrency semaphore，不实现失败率开路或半开恢复。
- per-session 日志只保存最多 2,000 字符的脱敏预览；不保存完整 system prompt、环境变量或完整工具结果。
- `SessionRecorder` 仍是 `messages.jsonl` 的唯一写入者；不要在 logger 中重复镜像消息。
- 全局日志继续由现有 Pino transport 写入 `~/.aidevspace/logs/agent.log`；不要创建第二个文件 writer。
- SDK API/类型必须以仓库已安装的 `@anthropic-ai/claude-agent-sdk` 0.3.206 声明为准。
- 不修改用户当前未跟踪的 `docs/design/` drafting 文件。
- 不运行 `next build`；本任务不修改 Web，验证使用 typecheck、Vitest 和 lint。

## File Structure

### 新增文件

- `apps/agent/src/error/ErrorClassifier.ts`：把 thrown error 或 SDK error envelope 稳定分类为 A–E/cancelled。
- `apps/agent/src/error/RetryStrategy.ts`：执行 attempt、固定退避、重试事件和最终失败包装。
- `apps/agent/src/error/CircuitBreaker.ts`：Provider 级 FIFO 并发信号量，支持排队取消和 shutdown。
- `apps/agent/src/log/SessionLogger.ts`：生成脱敏摘要并 append per-session `log.jsonl`。
- `apps/agent/src/log/GlobalLogger.ts`：把结构化生命周期事件适配到现有 Pino logger。
- `apps/agent/src/__tests__/ErrorClassifier.test.ts`
- `apps/agent/src/__tests__/RetryStrategy.test.ts`
- `apps/agent/src/__tests__/CircuitBreaker.test.ts`
- `apps/agent/src/__tests__/SessionLogger.test.ts`
- `apps/agent/src/__tests__/GlobalLogger.test.ts`

### 修改文件

- `apps/agent/src/providers/AIProvider.ts`：为持久化恢复增加可选 `localSid`。
- `apps/agent/src/providers/AIEvent.ts`：新增 `retrying` variant；error 增加可选分类。
- `apps/agent/src/session/AISession.ts`：接入 limiter、retry、取消、日志、初始 resume 和 usage。
- `apps/agent/src/providers/ClaudeCodeProvider.ts`：映射 SDK result/api_retry/usage，传递 cwd/resume，共享 limiter。
- `apps/agent/src/session/sessionPaths.ts`：新增 `logPathFor()`。
- `apps/agent/src/session/SessionStore.ts`：新增 `last_cancel_at`。
- `apps/agent/src/session/SessionRecorder.ts`：记录 retry/error 分类，不重复写 partial。
- `apps/agent/src/session/ResumeManager.ts`：传递已有 `localSid`，保证磁盘会话与 live session ID 一致。
- `packages/shared/src/sse.ts`：新增 typed `ai_event/retrying/query_failed/query_cancelled`。
- `apps/agent/src/routes/spike.ts`：真实创建 meta、attach recorder、维护 live session、取消 endpoint、typed SSE。
- `apps/agent/src/server.ts`：构建 store/mirror/loggers/limiter，并记录 Agent 启停。
- 相关现有测试：`AISession.test.ts`、`ClaudeCodeProvider.test.ts`、`sessionPaths.test.ts`、`SessionStore.test.ts`、`SessionRecorder.test.ts`、`ResumeManager.test.ts`、`spikeRoutes.test.ts`。

---

### Task 1: ErrorClassifier

**Files:**

- Create: `apps/agent/src/error/ErrorClassifier.ts`
- Test: `apps/agent/src/__tests__/ErrorClassifier.test.ts`

**Interfaces:**

- Consumes: thrown `unknown`、可选 `AbortSignal`。
- Produces: `ErrorCategory`、`ClassifiedError`、`classifyError(error, signal)`；Task 2、6、8 直接依赖这些精确名字。

- [ ] **Step 1: 写失败测试，覆盖取消、A–E 和未知错误**

```ts
import { describe, expect, it } from 'vitest'
import { classifyError } from '../error/ErrorClassifier.js'

describe('classifyError', () => {
  it.each([
    [{ status: 429, type: 'rate_limit_error', message: 'slow down' }, 'A'],
    [{ code: 'rate_limit', message: 'SDK rate limit' }, 'A'],
    [{ status: 503, type: 'api_error', message: 'unavailable' }, 'A'],
    [{ code: 'API_TIMEOUT', message: 'API request timed out' }, 'A'],
    [{ status: 401, type: 'authentication_error', message: 'bad key' }, 'B'],
    [{ status: 403, type: 'billing_error', message: 'quota exhausted' }, 'B'],
    [{ status: 400, type: 'invalid_request_error', message: 'bad request' }, 'B'],
    [{ code: 'ENOENT', syscall: 'spawn claude', message: 'spawn failed' }, 'C'],
    [{ exitCode: 7, message: 'CLI exited' }, 'C'],
    [{ code: 'ECONNRESET', message: 'socket closed' }, 'D'],
    [{ code: 'error_max_turns', message: 'max turns reached' }, 'E'],
  ])('classifies %j as %s', (error, category) => {
    expect(classifyError(error).category).toBe(category)
  })

  it('treats quota 429 as permanent before generic rate-limit matching', () => {
    expect(classifyError({ status: 429, type: 'billing_error', message: 'out of credits' })).toMatchObject({
      category: 'B', retryable: false, maxRetries: 0,
    })
  })

  it('classifies AbortError and an aborted signal as cancelled', () => {
    expect(classifyError(new DOMException('stopped', 'AbortError')).category).toBe('cancelled')
    const controller = new AbortController()
    controller.abort('user')
    expect(classifyError(new Error('anything'), controller.signal).category).toBe('cancelled')
  })

  it('walks cause and defaults unknown failures to B', () => {
    expect(classifyError(new Error('outer', { cause: { code: 'ECONNREFUSED' } })).category).toBe('D')
    expect(classifyError(new Error('mystery'))).toMatchObject({ category: 'B', retryable: false })
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ErrorClassifier.test.ts`

Expected: FAIL，提示无法解析 `../error/ErrorClassifier.js`。

- [ ] **Step 3: 实现稳定分类接口和优先级**

```ts
export type ErrorCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'cancelled'

export interface ClassifiedError {
  category: ErrorCategory
  code: string
  message: string
  retryable: boolean
  maxRetries: number
  original: unknown
}

const PROCESS_CODES = new Set(['ENOENT', 'EACCES', 'EPERM'])
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'])
const API_TRANSIENT_CODES = new Set(['rate_limit', 'rate_limit_error', 'overloaded', 'overloaded_error', 'server_error', 'api_error', 'API_TIMEOUT'])
const BUSINESS_CODES = new Set([
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
  'agent_abandoned',
  'agent_gave_up',
])

export function classifyError(error: unknown, signal?: AbortSignal): ClassifiedError {
  const chain = errorChain(error)
  const code = firstString(chain, ['code', 'errorCode', 'type', 'subtype']) ?? 'unknown_error'
  const message = firstString(chain, ['message']) ?? String(error)
  const name = firstString(chain, ['name'])
  const status = firstNumber(chain, ['status', 'statusCode', 'error_status'])
  const exitCode = firstNumber(chain, ['exitCode', 'exit_code'])
  const normalized = `${code} ${message}`.toLowerCase()

  if (signal?.aborted || name === 'AbortError' || code === 'ABORT_ERR') {
    return result('cancelled', code, message, false, 0, error)
  }
  if (BUSINESS_CODES.has(code) || /max turns|agent (abandoned|gave up)/i.test(message)) {
    return result('E', code, message, false, 0, error)
  }
  if (PROCESS_CODES.has(code) || (exitCode !== undefined && exitCode !== 0) || /spawn|cli exited|process exited/i.test(message)) {
    return result('C', code, message, true, 1, error)
  }
  if (NETWORK_CODES.has(code) || /socket|connection reset|connection refused|network error/i.test(message)) {
    return result('D', code, message, true, 3, error)
  }
  if (/billing|quota exhausted|out of credits|credits required|invalid api key|authentication|permission denied/.test(normalized)) {
    return result('B', code, message, false, 0, error)
  }
  if (status === 408 || status === 429 || (status !== undefined && status >= 500) || API_TRANSIENT_CODES.has(code)) {
    return result('A', code, message, true, 3, error)
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return result('B', code, message, false, 0, error)
  }
  return result('B', code, message, false, 0, error)
}

function result(
  category: ErrorCategory,
  code: string,
  message: string,
  retryable: boolean,
  maxRetries: number,
  original: unknown,
): ClassifiedError {
  return { category, code, message, retryable, maxRetries, original }
}

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const record = current as Record<string, unknown>
    chain.push(record)
    current = record['cause']
  }
  return chain
}

function firstString(chain: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of chain) {
    for (const key of keys) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return undefined
}

function firstNumber(chain: Array<Record<string, unknown>>, keys: string[]): number | undefined {
  for (const record of chain) {
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key]
    }
  }
  return undefined
}
```

实现时保留上述优先级；若 lint 要求拆行，只改格式，不改判断次序。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ErrorClassifier.test.ts`

Expected: PASS，全部分类用例通过。

- [ ] **Step 5: 运行 Agent typecheck**

Run: `pnpm --filter @ai-devspace/agent typecheck`

Expected: exit 0。

- [ ] **Step 6: 提交 Task 1**

```bash
git add apps/agent/src/error/ErrorClassifier.ts apps/agent/src/__tests__/ErrorClassifier.test.ts
git commit -m "feat(agent): classify SDK and runtime errors"
```

---

### Task 2: RetryStrategy

**Files:**

- Create: `apps/agent/src/error/RetryStrategy.ts`
- Test: `apps/agent/src/__tests__/RetryStrategy.test.ts`

**Interfaces:**

- Consumes: `classifyError()` 和 `ClassifiedError`。
- Produces: `RetryEvent`、`RetryExecution<T>`、`RetryFailure`、`executeWithRetry()`；Task 6 使用该执行器。

- [ ] **Step 1: 写失败测试，固定 A/D/C schedule 和 B/E/cancel 行为**

```ts
import { describe, expect, it, vi } from 'vitest'
import { executeWithRetry, RetryFailure } from '../error/RetryStrategy.js'

describe('executeWithRetry', () => {
  it('retries A exactly three times with 1s/3s/10s and emits counters', async () => {
    const sleeps: number[] = []
    const retries: Array<{ retry: number; maxRetries: number; delayMs: number }> = []
    let calls = 0
    const result = await executeWithRetry(
      async () => {
        calls++
        if (calls < 4) throw { status: 429, type: 'rate_limit_error', message: 'slow down' }
        return 'ok'
      },
      {
        sleep: async (ms) => { sleeps.push(ms) },
        onRetry: (event) => { retries.push(event) },
      },
    )
    expect(result).toEqual({ value: 'ok', attempts: 4, retryDelaysMs: [1000, 3000, 10000] })
    expect(sleeps).toEqual([1000, 3000, 10000])
    expect(retries).toEqual([
      expect.objectContaining({ retry: 1, maxRetries: 3, delayMs: 1000 }),
      expect.objectContaining({ retry: 2, maxRetries: 3, delayMs: 3000 }),
      expect.objectContaining({ retry: 3, maxRetries: 3, delayMs: 10000 }),
    ])
  })

  it('retries C once and wraps the final failure with metadata', async () => {
    const operation = vi.fn(async () => { throw { code: 'ENOENT', message: 'spawn failed' } })
    await expect(executeWithRetry(operation, { sleep: async () => {} })).rejects.toMatchObject({
      name: 'RetryFailure', attempts: 2, retryDelaysMs: [1000],
      classification: expect.objectContaining({ category: 'C' }),
    })
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ status: 401, message: 'invalid api key' }, 'B'],
    [{ code: 'error_max_turns', message: 'max turns reached' }, 'E'],
  ])('does not retry %j', async (error, category) => {
    const operation = vi.fn(async () => { throw error })
    await expect(executeWithRetry(operation)).rejects.toBeInstanceOf(RetryFailure)
    expect(operation).toHaveBeenCalledTimes(1)
    await executeWithRetry(operation).catch((caught: unknown) => {
      expect((caught as RetryFailure).classification.category).toBe(category)
    })
  })

  it('does not schedule a retry when canRetry returns false', async () => {
    const onRetry = vi.fn()
    await expect(executeWithRetry(
      async () => { throw { status: 503, message: 'unavailable' } },
      { canRetry: () => false, onRetry },
    )).rejects.toBeInstanceOf(RetryFailure)
    expect(onRetry).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/RetryStrategy.test.ts`

Expected: FAIL，提示 `RetryStrategy.js` 不存在。

- [ ] **Step 3: 实现 executeWithRetry 和 abortable default sleep**

```ts
import { classifyError, type ClassifiedError } from './ErrorClassifier.js'

export interface RetryEvent {
  classification: ClassifiedError
  retry: number
  maxRetries: number
  delayMs: number
}

export interface RetryExecution<T> {
  value: T
  attempts: number
  retryDelaysMs: number[]
}

export interface ExecuteWithRetryOptions {
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  onRetry?: (event: RetryEvent) => void | Promise<void>
  canRetry?: (error: unknown, classification: ClassifiedError) => boolean
}

export class RetryFailure extends Error {
  readonly classification: ClassifiedError
  readonly attempts: number
  readonly retryDelaysMs: number[]

  constructor(classification: ClassifiedError, attempts: number, retryDelaysMs: number[]) {
    super(classification.message, { cause: classification.original })
    this.name = 'RetryFailure'
    this.classification = classification
    this.attempts = attempts
    this.retryDelaysMs = retryDelaysMs
  }
}

const GENERAL_DELAYS = [1000, 3000, 10000] as const
const PROCESS_DELAYS = [1000] as const

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: ExecuteWithRetryOptions = {},
): Promise<RetryExecution<T>> {
  const sleep = options.sleep ?? abortableSleep
  const retryDelaysMs: number[] = []
  let attempts = 0

  while (true) {
    attempts++
    try {
      const value = await operation(attempts)
      return { value, attempts, retryDelaysMs }
    } catch (error) {
      const classification = classifyError(error, options.signal)
      const schedule = classification.category === 'C'
        ? PROCESS_DELAYS
        : classification.category === 'A' || classification.category === 'D'
          ? GENERAL_DELAYS
          : []
      const retry = attempts
      const allowed = classification.retryable
        && retry <= schedule.length
        && (options.canRetry?.(error, classification) ?? true)
      if (!allowed) throw new RetryFailure(classification, attempts, retryDelaysMs)

      const delayMs = schedule[retry - 1]
      await options.onRetry?.({
        classification,
        retry,
        maxRetries: schedule.length,
        delayMs,
      })
      retryDelaysMs.push(delayMs)
      await sleep(delayMs, options.signal)
    }
  }
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
```

实现时在 timer resolve 后移除 abort listener，避免长生命周期 signal 保留已完成 sleep 的闭包。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/RetryStrategy.test.ts`

Expected: PASS，测试总耗时不包含真实 14 秒等待。

- [ ] **Step 5: 联跑分类与重试测试**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ErrorClassifier.test.ts src/__tests__/RetryStrategy.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 Task 2**

```bash
git add apps/agent/src/error/RetryStrategy.ts apps/agent/src/__tests__/RetryStrategy.test.ts
git commit -m "feat(agent): add bounded retry strategy"
```

---

### Task 3: FIFO CircuitBreaker

**Files:**

- Create: `apps/agent/src/error/CircuitBreaker.ts`
- Test: `apps/agent/src/__tests__/CircuitBreaker.test.ts`

**Interfaces:**

- Consumes: Promise-returning query operation 和可选 `AbortSignal`。
- Produces: `CircuitBreaker.run()`、`stats()`、`close()`；Provider 只创建一个实例并注入所有 session。

- [ ] **Step 1: 写失败测试，验证 5 并发、第 6 个等待、FIFO、异常释放和取消**

```ts
import { describe, expect, it, vi } from 'vitest'
import { CircuitBreaker } from '../error/CircuitBreaker.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('CircuitBreaker', () => {
  it('runs five operations and queues the sixth until a slot is released', async () => {
    const breaker = new CircuitBreaker({ limit: 5 })
    const gates = Array.from({ length: 6 }, deferred)
    const started: number[] = []
    const jobs = gates.map((gate, index) => breaker.run(async () => {
      started.push(index)
      await gate.promise
      return index
    }))
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(breaker.stats()).toEqual({ limit: 5, active: 5, queued: 1 })
    gates[0].resolve()
    await jobs[0]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3, 4, 5])
    gates.slice(1).forEach((gate) => gate.resolve())
    await Promise.all(jobs)
  })

  it('serves queued operations in FIFO order and releases on rejection', async () => {
    const breaker = new CircuitBreaker({ limit: 1 })
    const gate = deferred()
    const order: string[] = []
    const first = breaker.run(async () => { await gate.promise; throw new Error('boom') })
    const second = breaker.run(async () => { order.push('second') })
    const third = breaker.run(async () => { order.push('third') })
    gate.resolve()
    await expect(first).rejects.toThrow('boom')
    await Promise.all([second, third])
    expect(order).toEqual(['second', 'third'])
  })

  it('removes an aborted waiter without consuming a slot', async () => {
    const breaker = new CircuitBreaker({ limit: 1 })
    const gate = deferred()
    const first = breaker.run(async () => { await gate.promise })
    const controller = new AbortController()
    const operation = vi.fn(async () => {})
    const waiting = breaker.run(operation, controller.signal)
    controller.abort('user')
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(breaker.stats().queued).toBe(0)
    gate.resolve()
    await first
    expect(operation).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/CircuitBreaker.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 FIFO semaphore**

```ts
interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface CircuitBreakerStats {
  limit: number
  active: number
  queued: number
}

export class CircuitBreaker {
  readonly #limit: number
  #active = 0
  #closed = false
  #waiters: Waiter[] = []

  constructor(options: { limit?: number } = {}) {
    this.#limit = options.limit ?? 5
    if (!Number.isInteger(this.#limit) || this.#limit < 1) {
      throw new Error('CircuitBreaker limit must be a positive integer')
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

  stats(): CircuitBreakerStats {
    return { limit: this.#limit, active: this.#active, queued: this.#waiters.length }
  }

  close(reason: unknown = new Error('CircuitBreaker closed')): void {
    this.#closed = true
    const waiters = this.#waiters.splice(0)
    for (const waiter of waiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort)
      waiter.reject(reason)
    }
  }

  async #acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.#closed) throw new Error('CircuitBreaker is closed')
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

注释必须说明：这里限制 in-flight，不根据失败率熔断。

- [ ] **Step 4: 运行测试、typecheck 并确认 GREEN**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/CircuitBreaker.test.ts && pnpm --filter @ai-devspace/agent typecheck`

Expected: 全部 PASS，exit 0。

- [ ] **Step 5: 提交 Task 3**

```bash
git add apps/agent/src/error/CircuitBreaker.ts apps/agent/src/__tests__/CircuitBreaker.test.ts
git commit -m "feat(agent): limit provider queries with FIFO queue"
```

---

### Task 4: SessionLogger、GlobalLogger 与持久化字段

**Files:**

- Create: `apps/agent/src/log/SessionLogger.ts`
- Create: `apps/agent/src/log/GlobalLogger.ts`
- Create: `apps/agent/src/__tests__/SessionLogger.test.ts`
- Create: `apps/agent/src/__tests__/GlobalLogger.test.ts`
- Modify: `apps/agent/src/session/sessionPaths.ts:3-36`
- Modify: `apps/agent/src/session/SessionStore.ts:27-55`
- Test: `apps/agent/src/__tests__/sessionPaths.test.ts`
- Test: `apps/agent/src/__tests__/SessionStore.test.ts`

**Interfaces:**

- Produces: `TokenUsageSummary`、`SessionQueryLogInput`、`SessionLogger.logQuery()`、`GlobalLogger`。
- Task 6 把 query 生命周期交给 `SessionLogger`；Task 8 把 Fastify Pino logger 交给 `GlobalLogger`。

- [ ] **Step 1: 扩展路径与 meta 的失败测试**

在 `sessionPaths.test.ts` 的 import 中加入 `logPathFor`，并在纯路径测试加入：

```ts
expect(logPathFor(root, 'REQ-1', 'sid-abc')).toBe(
  join(root, 'requirements', 'REQ-1', 'sessions', 'sid-abc', 'log.jsonl'),
)
```

在 `SessionStore.test.ts` 的 update 测试后加入：

```ts
it('记录 last_cancel_at 并刷新 last_active_at', async () => {
  let t = '2026-07-13T00:00:00.000Z'
  const store = new SessionStore({ root, now: () => t })
  const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
  t = '2026-07-13T02:00:00.000Z'
  const updated = await store.updateSession(meta.sid, {
    last_cancel_at: '2026-07-13T01:59:59.000Z',
  })
  expect(updated.last_cancel_at).toBe('2026-07-13T01:59:59.000Z')
  expect(updated.last_active_at).toBe(t)
})
```

- [ ] **Step 2: 运行路径/meta 测试并确认 RED**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/sessionPaths.test.ts src/__tests__/SessionStore.test.ts`

Expected: FAIL，`logPathFor` 未导出、`last_cancel_at` 不在类型中。

- [ ] **Step 3: 添加路径函数和 meta 字段**

在 `sessionPaths.ts` 增加：

```ts
export function logPathFor(root: string, reqId: string, localSid: string): string {
  return join(sessionDirFor(root, reqId, localSid), 'log.jsonl')
}
```

在 `SessionMeta` 增加：

```ts
/** 用户最近一次取消 query 的 ISO 8601 时间 */
last_cancel_at?: string
```

- [ ] **Step 4: 写 SessionLogger 失败测试**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLogger } from '../log/SessionLogger.js'
import { logPathFor } from '../session/sessionPaths.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aidev-session-log-')) })
afterEach(() => { if (existsSync(root)) rmSync(root, { recursive: true, force: true }) })

describe('SessionLogger', () => {
  it('writes one redacted and truncated JSONL record', async () => {
    const logger = new SessionLogger({ root, now: () => '2026-07-13T00:00:00.000Z', maxPreviewChars: 12 })
    await logger.logQuery({
      localSid: 'sid-1', reqId: 'REQ-1', durationMs: 42, attempts: 2,
      retryDelaysMs: [1000], status: 'succeeded',
      inputText: 'apiKey=secret-value and more', outputText: 'abcdefghijklmnop', incomplete: false,
      tokens: { input: 10, output: 4, cacheRead: null, cacheCreation: null }, error: null,
    })
    const line = readFileSync(logPathFor(root, 'REQ-1', 'sid-1'), 'utf8').trim()
    const record = JSON.parse(line)
    expect(record.timestamp).toBe('2026-07-13T00:00:00.000Z')
    expect(record.input.preview).not.toContain('secret-value')
    expect(record.output).toMatchObject({ preview: 'abcdefghijkl', characters: 16, truncated: true })
    expect(record.tokens.input).toBe(10)
  })

  it('uses null token fields and reports write failures without throwing', async () => {
    const onWriteError = vi.fn()
    const logger = new SessionLogger({ root: '\0invalid', onWriteError })
    await expect(logger.logQuery({
      localSid: 'sid', reqId: 'REQ', durationMs: 1, attempts: 1,
      retryDelaysMs: [], status: 'failed', inputText: 'q', outputText: '', incomplete: true,
      tokens: null, error: { category: 'B', code: 'bad', message: 'failed' },
    })).resolves.toBeUndefined()
    expect(onWriteError).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 5: 实现 SessionLogger**

定义以下公开类型和类：

```ts
export interface TokenUsageSummary {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}

export interface SessionQueryLogInput {
  localSid: string
  reqId: string
  durationMs: number
  attempts: number
  retryDelaysMs: number[]
  status: 'succeeded' | 'failed' | 'cancelled' | 'business_error'
  inputText: string
  outputText: string
  incomplete: boolean
  tokens: TokenUsageSummary | null
  error: { category: 'A' | 'B' | 'C' | 'D' | 'E'; code: string; message: string } | null
}

export class SessionLogger {
  constructor(options: {
    root: string
    now?: () => string
    maxPreviewChars?: number
    onWriteError?: (error: unknown, input: SessionQueryLogInput) => void
  })
  logQuery(input: SessionQueryLogInput): Promise<void>
}
```

`logQuery()` 必须：

```ts
const tokens = input.tokens ?? {
  input: null, output: null, cacheRead: null, cacheCreation: null,
}
const record = {
  timestamp: this.#now(),
  localSid: input.localSid,
  reqId: input.reqId,
  durationMs: input.durationMs,
  attempts: input.attempts,
  retryDelaysMs: input.retryDelaysMs,
  status: input.status,
  input: summarize(input.inputText, this.#maxPreviewChars),
  output: { ...summarize(input.outputText, this.#maxPreviewChars), incomplete: input.incomplete },
  tokens,
  error: input.error,
}
```

使用 `mkdir(sessionDirFor(...), {recursive:true})` 与 `appendFile(logPathFor(...), JSON.stringify(record) + '\n', 'utf8')`。catch 内调用 `onWriteError`，不重新抛出。`summarize()` 先将 Bearer token、`apiKey=...`、`token=...`、`secret=...` 替换为 `[REDACTED]`，再截断。

- [ ] **Step 6: 写并实现 GlobalLogger**

测试使用内存 sink：

```ts
const calls: unknown[][] = []
const sink = {
  info: (...args: unknown[]) => { calls.push(args) },
  warn: (...args: unknown[]) => { calls.push(args) },
  error: (...args: unknown[]) => { calls.push(args) },
}
const logger = new GlobalLogger(sink)
logger.agentStarted({ root: '/workspace', version: '1.0.0' })
expect(calls[0][0]).toMatchObject({ event: 'agent_started', root: '/workspace' })
```

实现：

```ts
export interface GlobalLogSink {
  info(bindings: object, message?: string): void
  warn(bindings: object, message?: string): void
  error(bindings: object, message?: string): void
}

export class GlobalLogger {
  constructor(readonly sink: GlobalLogSink) {}

  agentStarted(context: { root: string; version: string }): void {
    this.sink.info({ event: 'agent_started', ...context }, 'agent started')
  }
  agentStopped(context: { reason: string }): void {
    this.sink.info({ event: 'agent_stopped', ...context }, 'agent stopped')
  }
  configChanged(context: { provider: string | null; model: string | null }): void {
    this.sink.info({ event: 'config_changed', ...context }, 'agent configuration loaded')
  }
  retryExhausted(context: object): void {
    this.sink.error({ event: 'query_retry_exhausted', ...context }, 'query retries exhausted')
  }
  queryFailed(context: object): void {
    this.sink.error({ event: 'query_failed', ...context }, 'query failed')
  }
  sessionLogWriteFailed(error: unknown, context: object): void {
    this.sink.error({ event: 'session_log_write_failed', err: error, ...context }, 'session log write failed')
  }
}
```

- [ ] **Step 7: 运行 logger、路径和 store 测试**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/SessionLogger.test.ts src/__tests__/GlobalLogger.test.ts src/__tests__/sessionPaths.test.ts src/__tests__/SessionStore.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交 Task 4**

```bash
git add apps/agent/src/log apps/agent/src/session/sessionPaths.ts apps/agent/src/session/SessionStore.ts apps/agent/src/__tests__/SessionLogger.test.ts apps/agent/src/__tests__/GlobalLogger.test.ts apps/agent/src/__tests__/sessionPaths.test.ts apps/agent/src/__tests__/SessionStore.test.ts
git commit -m "feat(agent): add session and global error logging"
```

---

### Task 5: AIEvent 与 typed SSE 契约

**Files:**

- Modify: `apps/agent/src/providers/AIEvent.ts:9-21`
- Modify: `packages/shared/src/sse.ts:4-66`
- Modify: `apps/agent/src/session/SessionRecorder.ts:83-135`
- Test: `apps/agent/src/__tests__/SessionRecorder.test.ts`

**Interfaces:**

- Produces: `AIEvent.retrying`，以及 `SseEvent` 的 `ai_event/retrying/query_failed/query_cancelled` variants。
- Task 6 发出 AIEvent；Task 8 将其映射到 SSE。

- [ ] **Step 1: 在 SessionRecorder 测试中加入 retry 不落 messages、错误分类落盘**

```ts
it('retrying 不写 messages;error 保留分类诊断', async () => {
  const { store, mirror, sid, reqId } = await setupMeta()
  const session = fakeSession([
    { type: 'retrying', category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: 'retrying' },
    { type: 'error', code: 'auth', message: 'bad key', recoverable: false, category: 'B' },
    { type: 'done', reason: 'error' },
  ], sid, reqId)
  const rec = attachRecorder(session, { store, mirror, idGen: () => 'err-1' })
  await rec.done
  const messages = await mirror.readMessages(sid)
  expect(messages).toHaveLength(1)
  expect(messages[0].sdkMessageRaw).toMatchObject({ code: 'auth', category: 'B' })
})
```

- [ ] **Step 2: 扩展 AIEvent union**

```ts
import type { ErrorCategory } from '../error/ErrorClassifier.js'

export type AIEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string; delta?: boolean }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'file_written'; path: string; lines: number }
  | { type: 'permission_request'; tool: string; input: unknown }
  | {
      type: 'retrying'
      category: Extract<ErrorCategory, 'A' | 'C' | 'D'>
      retry: number
      maxRetries: number
      delayMs: number
      message: string
    }
  | {
      type: 'error'
      code: string
      message: string
      recoverable: boolean
      category?: Exclude<ErrorCategory, 'cancelled'>
    }
  | { type: 'done'; reason: DoneReason; sessionId?: string }
```

已有 variant 字段保持不变，只新增 variant 和可选字段。

- [ ] **Step 3: 扩展 shared SSE union**

先定义可序列化 payload：

```ts
export type AiSsePayload =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string; delta?: boolean }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'file_written'; path: string; lines: number }
  | { type: 'permission_request'; tool: string; input: unknown }
  | { type: 'error'; code: string; message: string; recoverable: boolean; category?: 'A' | 'B' | 'C' | 'D' | 'E' }
  | { type: 'done'; reason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens'; sessionId?: string }
```

再向 `SseEvent` union 新增：

```ts
| {
    type: 'ai_event'
    reqId: string
    sessionId: string
    runId: string
    ts: number
    event: AiSsePayload
  }
| {
    type: 'retrying'
    reqId: string
    sessionId: string
    runId: string
    ts: number
    category: 'A' | 'C' | 'D'
    retry: number
    maxRetries: number
    delayMs: number
    message: string
  }
| {
    type: 'query_failed'
    reqId: string
    sessionId: string
    runId: string
    ts: number
    category: 'A' | 'B' | 'C' | 'D' | 'E'
    code: string
    message: string
    retryable: boolean
  }
| {
    type: 'query_cancelled'
    reqId: string
    sessionId: string
    runId: string
    ts: number
  }
```

- [ ] **Step 4: 更新 SessionRecorder switch**

在 `case 'error'` 的 raw 数据加入 `category`，并在其前增加：

```ts
case 'retrying':
  return
case 'error':
  await emit('error', 'system', ev.message, {
    code: ev.code,
    recoverable: ev.recoverable,
    ...(ev.category ? { category: ev.category } : {}),
  })
  return
```

- [ ] **Step 5: 运行 shared typecheck 和 recorder 测试**

Run: `pnpm --filter @ai-devspace/shared typecheck && pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/SessionRecorder.test.ts && pnpm --filter @ai-devspace/agent typecheck`

Expected: PASS。

- [ ] **Step 6: 提交 Task 5**

```bash
git add packages/shared/src/sse.ts apps/agent/src/providers/AIEvent.ts apps/agent/src/session/SessionRecorder.ts apps/agent/src/__tests__/SessionRecorder.test.ts
git commit -m "feat(shared): define typed query lifecycle events"
```

---

### Task 6: AiSession turn orchestration

**Files:**

- Modify: `apps/agent/src/session/AISession.ts:23-411`
- Test: `apps/agent/src/__tests__/AISession.test.ts`

**Interfaces:**

- Consumes: `CircuitBreaker`、`executeWithRetry()`、`SessionLogger`、初始 SDK session ID 和外部 signal。
- Produces: 对现有 `AISession` 接口保持兼容的 retry/cancel/logging 行为。

- [ ] **Step 1: 添加 RED 测试——初始 resume、A/C/B/E、partial 安全门**

在 `AISession.test.ts` 增加 helper，使测试可注入 `retrySleep: async () => {}`，然后新增：

```ts
it('uses initialSdkSessionId on the first turn', async () => {
  const resumes: Array<string | undefined> = []
  const session = new AiSession({
    id: 's-1', reqId: 'r-1', topic: 't', kind: 'chat', initialSdkSessionId: 'sdk-old',
    adapter: { async *runTurn({ resume }) { resumes.push(resume); yield { kind: 'result', sessionId: resume } } },
  })
  await session.send('q')
  expect(resumes).toEqual(['sdk-old'])
})

it('retries transient throws and emits retrying before success', async () => {
  let calls = 0
  const session = new AiSession({
    id: 's-1', reqId: 'r-1', topic: 't', kind: 'chat', retrySleep: async () => {},
    adapter: {
      async *runTurn() {
        calls++
        if (calls < 3) throw { status: 429, message: 'slow down' }
        yield { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' }
      },
    },
  })
  const eventsP = collectEvents(session)
  await session.send('q')
  const events = await eventsP
  expect(events.filter((event) => event.type === 'retrying')).toEqual([
    expect.objectContaining({ category: 'A', retry: 1, delayMs: 1000 }),
    expect.objectContaining({ category: 'A', retry: 2, delayMs: 3000 }),
  ])
  expect(session.state).toBe('idle')
})

it('does not retry auth failures and moves to errored', async () => {
  let calls = 0
  const session = new AiSession({
    id: 's-1', reqId: 'r-1', topic: 't', kind: 'chat', retrySleep: async () => {},
    adapter: { async *runTurn() { calls++; throw { status: 401, message: 'invalid api key' } } },
  })
  const eventsP = collectEvents(session)
  await session.send('q')
  const events = await eventsP
  expect(calls).toBe(1)
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', category: 'B' }))
  expect(session.state).toBe('errored')
})

it('keeps the session idle after an E business error', async () => {
  const session = new AiSession({
    id: 's-1', reqId: 'r-1', topic: 't', kind: 'chat',
    adapter: makeAdapter([{ kind: 'error', errorCode: 'error_max_turns', message: 'max turns' }]),
  })
  const eventsP = collectEvents(session)
  await session.send('q')
  expect(await eventsP).toContainEqual(expect.objectContaining({ type: 'error', category: 'E' }))
  expect(session.state).toBe('idle')
})
```

- [ ] **Step 2: 添加 RED 测试——共享 limiter、外部 signal、取消 callback 和 query logger**

```ts
it('aborts a queued turn and invokes onCancelled without retrying', async () => {
  const breaker = new CircuitBreaker({ limit: 1 })
  const blocker = deferred()
  const first = breaker.run(async () => { await blocker.promise })
  const onCancelled = vi.fn(async () => {})
  const session = new AiSession({
    id: 's-1', reqId: 'r-1', topic: 't', kind: 'chat', circuitBreaker: breaker, onCancelled,
    adapter: makeAdapter([{ kind: 'result', reason: 'end_turn' }]),
  })
  const eventsP = collectEvents(session)
  const sendP = session.send('q')
  await Promise.resolve()
  await session.cancel('user')
  await sendP
  expect((await eventsP).at(-1)).toMatchObject({ type: 'done', reason: 'cancelled' })
  expect(onCancelled).toHaveBeenCalledWith(expect.objectContaining({ localSid: 's-1', reason: 'user' }))
  blocker.resolve()
  await first
})

it('writes one query summary after completion', async () => {
  const logQuery = vi.fn(async () => {})
  const session = new AiSession({
    id: 's-1', reqId: 'r-1', topic: 't', kind: 'chat',
    sessionLogger: { logQuery } as unknown as SessionLogger,
    nowMs: (() => { let n = 0; return () => n++ === 0 ? 100 : 150 })(),
    adapter: makeAdapter([
      { kind: 'assistant', text: 'answer', sessionId: 'sdk-1' },
      { kind: 'result', reason: 'end_turn', sessionId: 'sdk-1', usage: { input: 3, output: 2, cacheRead: 1, cacheCreation: 0 } },
    ]),
  })
  await session.send('question')
  expect(logQuery).toHaveBeenCalledWith(expect.objectContaining({
    localSid: 's-1', reqId: 'r-1', attempts: 1,
    inputText: 'question', outputText: 'answer', status: 'succeeded', durationMs: 50,
  }))
})
```

测试文件需 import `vi`、`CircuitBreaker`、`SessionLogger`，并复用 Task 3 的 deferred 形态。

- [ ] **Step 3: 扩展 SdkMessageEnvelope 和 AiSessionDeps**

在 `AISession.ts` 定义：

```ts
export interface SdkUsage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}
```

给 result 增加 `usage?: SdkUsage`，给 error 增加 `status?: number; error?: unknown`，并新增：

```ts
| {
    kind: 'retrying'
    sessionId?: string
    category: 'A' | 'D'
    retry: number
    maxRetries: number
    delayMs: number
  }
```

给 `AiSessionDeps` 增加：

```ts
initialSdkSessionId?: string
circuitBreaker?: CircuitBreaker
retrySleep?: (ms: number, signal?: AbortSignal) => Promise<void>
sessionLogger?: SessionLogger
onCancelled?: (context: { localSid: string; reqId: string; reason: string }) => void | Promise<void>
nowMs?: () => number
globalLogger?: GlobalLogger
```

constructor 中保存依赖，并执行：

```ts
this.#sdkSessionId = deps.initialSdkSessionId
this.#externalSignal = deps.signal
this.#circuitBreaker = deps.circuitBreaker
this.#retrySleep = deps.retrySleep
this.#sessionLogger = deps.sessionLogger
this.#onCancelled = deps.onCancelled
this.#nowMs = deps.nowMs ?? (() => Date.now())
this.#globalLogger = deps.globalLogger
```

- [ ] **Step 4: 将单次 adapter stream 提取为 #runAttempt**

该方法必须在遇到 error envelope 时抛出可分类对象，而不是立即推最终 error：

```ts
async #runAttempt(input: {
  text: string
  appendSystemPrompt?: string
  signal: AbortSignal
  onText: (text: string) => void
  markOutput: () => void
}): Promise<{ reason: DoneReason; usage: SdkUsage | null }> {
  const stream = this.#adapter.runTurn({
    prompt: input.text,
    resume: this.#sdkSessionId,
    signal: input.signal,
    appendSystemPrompt: input.appendSystemPrompt,
  })
  for await (const env of stream) {
    if (env.sessionId) this.#sdkSessionId = env.sessionId
    if (env.kind === 'error') {
      throw {
        code: env.errorCode ?? 'sdk_error',
        status: env.status,
        message: env.message ?? 'unknown error',
        cause: env.error,
      }
    }
    const events = mapSdkEnvelope(env)
    for (const event of events) {
      if (event.type === 'text') {
        input.onText(event.text)
        input.markOutput()
      }
      this.#push(event)
    }
    if (env.kind === 'result') {
      const reason: DoneReason = env.reason === 'max_tokens'
        ? 'max_tokens'
        : env.reason === 'cancelled'
          ? 'cancelled'
          : 'end_turn'
      return { reason, usage: env.usage ?? null }
    }
  }
  this.#push({ type: 'done', reason: 'end_turn', sessionId: this.#sdkSessionId })
  return { reason: 'end_turn', usage: null }
}
```

`mapSdkEnvelope()` 的 `retrying` 分支产生 `AIEvent.retrying`；error 分支不再负责最终分类，保留为不可达兼容分支或移除后由 switch exhaustiveness 保证。

- [ ] **Step 5: 用 limiter + executeWithRetry 重写 #runTurn 核心**

保留现有 system prompt assembly，然后执行：

```ts
const startedAt = this.#nowMs()
let outputText = ''
let sawOutputWithoutResume = false
let attempts = 1
let retryDelaysMs: number[] = []
let usage: SdkUsage | null = null
let status: SessionQueryLogInput['status'] = 'succeeded'
let finalError: SessionQueryLogInput['error'] = null

const execute = async (): Promise<void> => {
  const result = await executeWithRetry(
    async () => await this.#runAttempt({
      text,
      appendSystemPrompt,
      signal,
      onText: (chunk) => { outputText += chunk },
      markOutput: () => { if (!this.#sdkSessionId) sawOutputWithoutResume = true },
    }),
    {
      signal,
      sleep: this.#retrySleep,
      canRetry: () => !sawOutputWithoutResume,
      onRetry: async ({ classification, retry, maxRetries, delayMs }) => {
        this.#push({
          type: 'retrying',
          category: classification.category as 'A' | 'C' | 'D',
          retry,
          maxRetries,
          delayMs,
          message: '连接异常，正在重试',
        })
      },
    },
  )
  attempts = result.attempts
  retryDelaysMs = result.retryDelaysMs
  usage = result.value.usage
  if (result.value.reason === 'cancelled') {
    status = 'cancelled'
    await this.#onCancelled?.({
      localSid: this.id,
      reqId: this.reqId,
      reason: String(signal.reason ?? 'cancelled'),
    })
  }
}

try {
  if (this.#circuitBreaker) await this.#circuitBreaker.run(execute, signal)
  else await execute()
  this.#state = 'idle'
} catch (error) {
  const failure = error instanceof RetryFailure
    ? error
    : new RetryFailure(classifyError(error, signal), attempts, retryDelaysMs)
  attempts = failure.attempts
  retryDelaysMs = failure.retryDelaysMs
  if (failure.classification.category === 'cancelled' || signal.aborted) {
    status = 'cancelled'
    this.#push({ type: 'done', reason: 'cancelled', sessionId: this.#sdkSessionId })
    this.#state = 'idle'
    await this.#onCancelled?.({
      localSid: this.id,
      reqId: this.reqId,
      reason: String(signal.reason ?? 'cancelled'),
    })
  } else {
    status = failure.classification.category === 'E' ? 'business_error' : 'failed'
    finalError = {
      category: failure.classification.category,
      code: failure.classification.code,
      message: failure.classification.message,
    }
    if (failure.classification.category !== 'E') {
      const context = {
        reqId: this.reqId,
        sessionId: this.id,
        category: failure.classification.category,
        code: failure.classification.code,
        attempts: failure.attempts,
      }
      if (failure.classification.retryable) this.#globalLogger?.retryExhausted(context)
      else this.#globalLogger?.queryFailed(context)
    }
    this.#push({
      type: 'error',
      code: finalError.code,
      message: finalError.message,
      recoverable: false,
      category: finalError.category,
    })
    this.#push({ type: 'done', reason: 'error', sessionId: this.#sdkSessionId })
    this.#state = failure.classification.category === 'E' ? 'idle' : 'errored'
  }
} finally {
  await this.#sessionLogger?.logQuery({
    localSid: this.id,
    reqId: this.reqId,
    durationMs: this.#nowMs() - startedAt,
    attempts,
    retryDelaysMs,
    status,
    inputText: text,
    outputText,
    incomplete: status !== 'succeeded',
    tokens: usage,
    error: finalError,
  })
}
```

在实际实现中不要用不安全 cast 掩盖 `cancelled`；通过 `classification.retryable` 与 category narrow 保证 `retrying` 只发 A/C/D。

- [ ] **Step 6: 联动外部 signal 与每轮 controller**

每轮 controller 创建后添加：

```ts
const abortFromExternal = (): void => controller.abort(this.#externalSignal?.reason)
if (this.#externalSignal?.aborted) abortFromExternal()
else this.#externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
```

finally 中执行：

```ts
this.#externalSignal?.removeEventListener('abort', abortFromExternal)
```

`cancel(reason)` 仍 abort 当前 controller，因此等待 limiter 和 retry sleep 都会被取消。

- [ ] **Step 7: 运行 AISession 测试并修复回归**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/AISession.test.ts`

Expected: 新旧测试全部 PASS。若旧测试的 error event 现在多出可选 `category`，使用 `toMatchObject` 断言，不删除新字段。

- [ ] **Step 8: 运行核心测试与 typecheck**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ErrorClassifier.test.ts src/__tests__/RetryStrategy.test.ts src/__tests__/CircuitBreaker.test.ts src/__tests__/SessionLogger.test.ts src/__tests__/AISession.test.ts && pnpm --filter @ai-devspace/agent typecheck`

Expected: PASS，exit 0。

- [ ] **Step 9: 提交 Task 6**

```bash
git add apps/agent/src/session/AISession.ts apps/agent/src/__tests__/AISession.test.ts
git commit -m "feat(agent): orchestrate retries and cancellation per turn"
```

---

### Task 7: ClaudeCodeProvider SDK 适配与共享 limiter

**Files:**

- Modify: `apps/agent/src/providers/AIProvider.ts:37-51`
- Modify: `apps/agent/src/providers/ClaudeCodeProvider.ts:28-247`
- Test: `apps/agent/src/__tests__/ClaudeCodeProvider.test.ts`

**Interfaces:**

- Consumes: Task 3 `CircuitBreaker`、Task 4 logger、Task 6 新 AiSessionDeps。
- Produces: `createSession({localSid,resume,cwd})` 的正确接线；SDK `api_retry/result/usage` envelope。

- [ ] **Step 1: 给 CreateSessionOptions 增加稳定 localSid**

```ts
/** 已落盘会话的稳定 local_sid；未传时 Provider 生成 UUID */
localSid?: string
```

`ResumeManager` 和 spike route 后续传入该字段。

- [ ] **Step 2: 添加 Provider RED 测试——resume、cwd、localSid、usage 和 native api_retry**

```ts
it('uses localSid/resume/cwd and maps SDK usage', async () => {
  const capture: { options?: Record<string, unknown> } = {}
  const queryFn = ((params: { options?: Record<string, unknown> }) => {
    capture.options = params.options
    return (async function* () {
      yield {
        type: 'result', subtype: 'success', session_id: 'sdk-old',
        usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
      }
    })()
  }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']
  const provider = createClaudeCodeProvider({ ccSwitch: makeFakeCcSwitch([currentProvider]), queryFn })
  const session = await provider.createSession('r-1', {
    localSid: 'local-1', topic: 't', kind: 'chat', resume: 'sdk-old', cwd: '/workspace/repo',
  })
  expect(session.id).toBe('local-1')
  const eventsP = collectUntilDone(session)
  await session.send('hi')
  await eventsP
  expect(capture.options?.['resume']).toBe('sdk-old')
  expect(capture.options?.['cwd']).toBe('/workspace/repo')
})
```

再加 native retry 测试，queryFn yield：

```ts
{
  type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3,
  retry_delay_ms: 1000, error_status: 429, error: 'rate_limit', session_id: 'sdk-1',
}
```

断言收到 `AIEvent.retrying`，category A、计数与 delay 原样保留。另加 assistant error 用例，yield `{type:'assistant', error:'authentication_failed', session_id:'sdk-1', message:{content:[]}}`，断言最终 `AIEvent.error` 为 category B，且 queryFn 只调用一次。

- [ ] **Step 3: 添加 Provider RED 测试——同一 Provider 的 6 个 session 共享 5-slot limiter**

创建 6 个 session 并让 mock queryFn 的前 5 个 stream 等 gate；断言第 6 次 queryFn 尚未调用。释放一个 gate 后，断言第 6 次被调用。测试结束释放全部 gate 并 `provider.shutdown()`。

- [ ] **Step 4: 扩展 ClaudeCodeProviderOptions**

```ts
circuitBreaker?: CircuitBreaker
retrySleep?: (ms: number, signal?: AbortSignal) => Promise<void>
sessionLogger?: SessionLogger
onSessionCancelled?: (context: { localSid: string; reqId: string; reason: string }) => void | Promise<void>
globalLogger?: GlobalLogger
```

在 factory 顶层只创建一次：

```ts
const circuitBreaker = opts.circuitBreaker ?? new CircuitBreaker({ limit: 5 })
```

- [ ] **Step 5: 修正 buildAdapter 参数与 AbortController listener 清理**

签名改为：

```ts
function buildAdapter(sessionModelId: string | null, cwd: string | undefined): SdkAdapter
```

设置：

```ts
sdkOptions['cwd'] = cwd ?? process.cwd()
```

signal bridge 使用具名 `abort`，并在 `for await` 的 finally 中 `removeEventListener`。不要把 `createOpts.signal` 直接传入 SDK；AiSession 每轮 signal 是唯一来源。

- [ ] **Step 6: 映射 SDK api_retry、result error 和 usage**

在 `toEnvelope()` 的 system 分支优先识别 `subtype === 'api_retry'`：

```ts
return {
  kind: 'retrying',
  sessionId,
  category: typeof m['error_status'] === 'number' ? 'A' : 'D',
  retry: Number(m['attempt'] ?? 1),
  maxRetries: Number(m['max_retries'] ?? 3),
  delayMs: Number(m['retry_delay_ms'] ?? 0),
}
```

在 `toEnvelope()` 的 assistant 分支读取 SDK 0.3.206 声明的 `SDKAssistantMessageError`：

```ts
const assistantError = typeof m['error'] === 'string' ? m['error'] : undefined
if (assistantError) {
  return {
    kind: 'error',
    sessionId,
    errorCode: assistantError,
    message: assistantError,
    error: m,
  }
}
```

这一步保证 `authentication_failed`、`billing_error`、`rate_limit`、`overloaded`、`server_error` 等 SDK 错误进入分类器，而不是被当作普通 assistant 文本吞掉。

result 分支：

```ts
const usageRecord = isRecord(m['usage']) ? m['usage'] : {}
const usage = {
  input: numberOrNull(usageRecord['input_tokens']),
  output: numberOrNull(usageRecord['output_tokens']),
  cacheRead: numberOrNull(usageRecord['cache_read_input_tokens']),
  cacheCreation: numberOrNull(usageRecord['cache_creation_input_tokens']),
}
if (subtype === 'success') {
  return { kind: 'result', sessionId, reason: 'end_turn', usage }
}
const errors = Array.isArray(m['errors']) ? m['errors'].filter((value): value is string => typeof value === 'string') : []
return {
  kind: 'error',
  sessionId,
  errorCode: subtype ?? 'error_during_execution',
  message: errors.join('; ') || subtype || 'SDK execution failed',
  error: m,
}
```

`error_max_turns`、`error_max_budget_usd` 和 `error_max_structured_output_retries` 由 classifier 归 E；`error_during_execution` 根据 errors/code/cause 分类。

- [ ] **Step 7: 用 createOpts 初始化 AiSession**

```ts
const localSid = createOpts.localSid ?? randomUUID()
const adapter = buildAdapter(modelId, createOpts.cwd)
const session = new AiSession({
  id: localSid,
  reqId,
  topic: createOpts.topic,
  kind: createOpts.kind,
  adapter,
  initialSdkSessionId: createOpts.resume,
  resolveModel: () => createOpts.model,
  signal: createOpts.signal,
  circuitBreaker,
  retrySleep: opts.retrySleep,
  sessionLogger: opts.sessionLogger,
  globalLogger: opts.globalLogger,
  onCancelled: opts.onSessionCancelled,
  debug,
  assembler,
  requirement,
})
```

`shutdown()` 先 `circuitBreaker.close()`，再清 query cache。

- [ ] **Step 8: 运行 Provider、AISession 和 limiter 测试**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ClaudeCodeProvider.test.ts src/__tests__/AISession.test.ts src/__tests__/CircuitBreaker.test.ts`

Expected: PASS。

- [ ] **Step 9: 运行 typecheck 并提交 Task 7**

Run: `pnpm --filter @ai-devspace/agent typecheck`

Expected: exit 0。

```bash
git add apps/agent/src/providers/AIProvider.ts apps/agent/src/providers/ClaudeCodeProvider.ts apps/agent/src/__tests__/ClaudeCodeProvider.test.ts
git commit -m "feat(provider): wire resilient Agent SDK sessions"
```

---

### Task 8: Resume、真实持久化、取消 route 和 typed SSE wiring

**Files:**

- Modify: `apps/agent/src/session/ResumeManager.ts:60-89`
- Test: `apps/agent/src/__tests__/ResumeManager.test.ts`
- Modify: `apps/agent/src/routes/spike.ts:31-165`
- Test: `apps/agent/src/__tests__/spikeRoutes.test.ts`
- Modify: `apps/agent/src/server.ts:54-153`

**Interfaces:**

- Consumes: stable `localSid`、SessionStore、MessagesMirror、SessionRecorder、GlobalLogger、typed SSE。
- Produces: `POST /api/spike/session/:id/cancel`；`POST /api/spike/run` 响应包含 `sessionId`；真实 query 自动写 meta/messages/log。

- [ ] **Step 1: 修复 ResumeManager identity 的 RED 测试**

在有效、无 SDK ID 和 recovered 三条测试中断言：

```ts
expect(calls[0].opts.localSid).toBe(meta.sid)
```

- [ ] **Step 2: 修改 ResumeManager baseOpts**

```ts
const baseOpts: CreateSessionOptions = {
  localSid: meta.sid,
  topic: meta.topic,
  kind: meta.kind,
  ...(meta.model !== undefined ? { model: meta.model } : {}),
  ...(meta.cwd !== undefined ? { cwd: meta.cwd } : {}),
}
```

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ResumeManager.test.ts`

Expected: PASS。

- [ ] **Step 3: 为 spike route 写 typed SSE RED 测试**

把现有 placeholder 断言替换为：

```ts
expect(received).toContainEqual(expect.objectContaining({
  type: 'ai_event',
  reqId: SPIKE_CHANNEL,
  event: { type: 'text', text: 'hi', delta: false },
}))
```

新增 fake provider 事件序列：

```ts
{ type: 'retrying', category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: 'retrying' },
{ type: 'error', code: 'auth', message: 'bad key', recoverable: false, category: 'B' },
{ type: 'done', reason: 'error', sessionId: 'sdk-1' },
```

断言 hub 分别收到 `retrying` 和 `query_failed`，且都含 `runId/reqId/sessionId/ts`。把现有“provider create 失败发布 placeholder”测试改为断言 `query_failed {category:'B', code:'session_create_failed'}`，POST 仍返回 202 和已落盘的 `sessionId`。

- [ ] **Step 4: 为持久化和取消 endpoint 写 RED 测试**

测试 setup 使用同一个 temp `root` 构建：

```ts
const store = new SessionStore({ root, now: () => '2026-07-13T00:00:00.000Z' })
const mirror = new MessagesMirror({ root })
```

注册 route 时传 `{hub,provider,ccSwitch,store,mirror}`。POST `/api/spike/run` 后断言 response 有 `sessionId`，随后读取 `messages.jsonl`。取消测试使用受控 fake session：

```ts
const run = await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'long' } })
const { sessionId } = run.json()
const cancel = await app.inject({ method: 'POST', url: `/api/spike/session/${sessionId}/cancel` })
expect(cancel.statusCode).toBe(202)
expect(cancel.json()).toEqual({ status: 'cancelling', sessionId })
expect(cancelSpy).toHaveBeenCalledWith('user')
```

另测不存在 session 返回 404。

- [ ] **Step 5: 扩展 SpikeRoutesOptions 并同步创建 session/meta**

```ts
export interface SpikeRoutesOptions {
  hub: SseHub
  provider: AIProvider
  ccSwitch: CcSwitchClient
  store: SessionStore
  mirror: MessagesMirror
}
```

route closure 内：

```ts
const liveSessions = new Map<string, AISession>()
```

POST 在返回 202 前执行：

```ts
const meta = await store.createSession(reqId, { topic: 'spike', kind: 'chat' })
let session: AISession
try {
  session = await provider.createSession(reqId, {
    localSid: meta.sid,
    topic: meta.topic,
    kind: meta.kind,
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  hub.publish(reqId, {
    type: 'query_failed',
    runId,
    reqId,
    sessionId: meta.sid,
    ts: Date.now(),
    category: 'B',
    code: 'session_create_failed',
    message,
    retryable: false,
  })
  return reply.code(202).send({
    status: 'accepted', runId, reqId, sessionId: meta.sid,
    promptPreview: prompt.slice(0, 80),
  })
}
liveSessions.set(session.id, session)
const recorder = attachRecorder(session, { store, mirror })
```

响应增加：

```ts
return reply.code(202).send({
  status: 'accepted', runId, reqId, sessionId: session.id,
  promptPreview: prompt.slice(0, 80),
})
```

- [ ] **Step 6: 实现 typed AIEvent -> SSE 映射**

导出便于单测的函数：

```ts
export function mapAiEventToSse(
  runId: string,
  reqId: string,
  sessionId: string,
  event: AIEvent,
  ts = Date.now(),
): SseEvent {
  if (event.type === 'retrying') {
    return {
      type: 'retrying',
      runId,
      reqId,
      sessionId,
      ts,
      category: event.category,
      retry: event.retry,
      maxRetries: event.maxRetries,
      delayMs: event.delayMs,
      message: event.message,
    }
  }
  if (event.type === 'error' && event.category !== 'E') {
    return {
      type: 'query_failed', runId, reqId, sessionId, ts,
      category: event.category ?? 'B', code: event.code,
      message: event.message, retryable: event.recoverable,
    }
  }
  if (event.type === 'done' && event.reason === 'cancelled') {
    return { type: 'query_cancelled', runId, reqId, sessionId, ts }
  }
  return { type: 'ai_event', runId, reqId, sessionId, ts, event }
}
```

- [ ] **Step 7: 等待 pump/recorder 完成并清理 live session**

异步运行块结构：

```ts
const pump = (async () => {
  for await (const event of session.events()) {
    hub.publish(reqId, mapAiEventToSse(runId, reqId, session.id, event))
  }
})()

void (async () => {
  try {
    await session.send(prompt)
  } catch (error) {
    fastify.log.error({ err: error, runId, sessionId: session.id }, '[spike] run failed')
    hub.publish(reqId, {
      type: 'query_failed', runId, reqId, sessionId: session.id, ts: Date.now(),
      category: 'B', code: 'run_failed',
      message: error instanceof Error ? error.message : String(error), retryable: false,
    })
  } finally {
    await session.close()
    await Promise.allSettled([pump, recorder.done])
    liveSessions.delete(session.id)
  }
})()
```

- [ ] **Step 8: 实现 cancel endpoint**

```ts
fastify.post<{ Params: { id: string } }>(
  '/api/spike/session/:id/cancel',
  { config: { public: true } },
  async (req, reply) => {
    const session = liveSessions.get(req.params.id)
    if (!session) {
      return reply.code(404).send({ error: 'session_not_running', sessionId: req.params.id })
    }
    void session.cancel('user')
    return reply.code(202).send({ status: 'cancelling', sessionId: session.id })
  },
)
```

取消时间由 Provider 注入的 `onSessionCancelled` 回调写入 store，不在 route 重复写。

- [ ] **Step 9: 在 server.ts 构建并注入持久化与日志依赖**

增加 imports 并在 provider 创建前构建：

```ts
const sessionStore = new SessionStore({ root: workspaceRoot })
const messagesMirror = new MessagesMirror({ root: workspaceRoot })
const globalLogger = new GlobalLogger(fastify.log)
const sessionLogger = new SessionLogger({
  root: workspaceRoot,
  onWriteError: (error, input) => globalLogger.sessionLogWriteFailed(error, {
    reqId: input.reqId,
    sessionId: input.localSid,
  }),
})
const circuitBreaker = new CircuitBreaker({ limit: 5 })
```

Provider：

```ts
const provider = createClaudeCodeProvider({
  ccSwitch,
  debug: false,
  circuitBreaker,
  sessionLogger,
  globalLogger,
  onSessionCancelled: async ({ localSid }) => {
    await sessionStore.updateSession(localSid, {
      last_cancel_at: new Date().toISOString(),
    })
  },
})
```

注册 route：

```ts
await fastify.register(spikeRoutes, {
  hub,
  provider,
  ccSwitch,
  store: sessionStore,
  mirror: messagesMirror,
})
```

完成初始化后：

```ts
globalLogger.agentStarted({ root: workspaceRoot, version: opts.agentVersion ?? '0.0.0' })
const configured = ccSwitch.getCurrent()
globalLogger.configChanged({
  provider: configured?.name ?? null,
  model: configured?.models.main ?? null,
})
```

onClose 的最后记录：

```ts
globalLogger.agentStopped({ reason: 'server_close' })
```

- [ ] **Step 10: 运行 route、持久化和 server 相关测试**

Run: `pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/ResumeManager.test.ts src/__tests__/SessionStore.test.ts src/__tests__/MessagesMirror.test.ts src/__tests__/SessionRecorder.test.ts src/__tests__/spikeRoutes.test.ts`

Expected: PASS。

- [ ] **Step 11: 运行 shared + Agent typecheck 并提交 Task 8**

Run: `pnpm --filter @ai-devspace/shared typecheck && pnpm --filter @ai-devspace/agent typecheck`

Expected: exit 0。

```bash
git add apps/agent/src/session/ResumeManager.ts apps/agent/src/routes/spike.ts apps/agent/src/server.ts apps/agent/src/__tests__/ResumeManager.test.ts apps/agent/src/__tests__/spikeRoutes.test.ts
git commit -m "feat(agent): persist and stream resilient query lifecycle"
```

---

### Task 9: 全量验证、规格核对与最终修正

**Files:**

- Modify only if verification finds a concrete defect in files changed by Tasks 1–8.
- Do not modify `apps/web` or unrelated `docs/design/` files.

**Interfaces:**

- Consumes: Tasks 1–8 的完整实现。
- Produces: 通过 typecheck、lint、Agent tests、shared tests 和仓库全套 tests 的最终提交。

- [ ] **Step 1: 运行所有新增和直接受影响测试**

Run:

```bash
pnpm --filter @ai-devspace/agent exec vitest run \
  src/__tests__/ErrorClassifier.test.ts \
  src/__tests__/RetryStrategy.test.ts \
  src/__tests__/CircuitBreaker.test.ts \
  src/__tests__/SessionLogger.test.ts \
  src/__tests__/GlobalLogger.test.ts \
  src/__tests__/AISession.test.ts \
  src/__tests__/ClaudeCodeProvider.test.ts \
  src/__tests__/SessionStore.test.ts \
  src/__tests__/SessionRecorder.test.ts \
  src/__tests__/ResumeManager.test.ts \
  src/__tests__/spikeRoutes.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行 shared 和 Agent typecheck**

Run: `pnpm --filter @ai-devspace/shared typecheck && pnpm --filter @ai-devspace/agent typecheck`

Expected: exit 0。

- [ ] **Step 3: 运行 Agent lint**

Run: `pnpm --filter @ai-devspace/agent lint`

Expected: exit 0，0 warnings。

- [ ] **Step 4: 运行 Agent 全套测试**

Run: `pnpm --filter @ai-devspace/agent test`

Expected: 全部 PASS；Windows 上仓库既有 POSIX permission/temp-dir 用例按现有 skip 条件处理。

- [ ] **Step 5: 运行 shared 测试和仓库全套测试**

Run: `pnpm --filter @ai-devspace/shared test && pnpm test`

Expected: 全部 workspace 测试 PASS。若失败，区分本次回归与既有环境失败并保留完整输出。

- [ ] **Step 6: 核对验收矩阵**

逐项用测试证据确认：

- rate limit：4 次 attempt，delay `[1000,3000,10000]`，3 个 retrying event；
- auth：1 次 attempt，无 retry，最终 category B；
- process：2 次 attempt，delay `[1000]`；
- 6 个并发：5 active + 1 FIFO queued；
- cancel：AbortController 触发、无 retry、partial incomplete、`last_cancel_at` 更新；
- 每次 query：`log.jsonl` 一条汇总；
- 全局 lifecycle：Pino `agent.log` 收到结构化事件；
- typed SSE：不再用 placeholder 承载 AIEvent JSON；
- Web UI：明确未修改。

- [ ] **Step 7: 检查 diff 和格式**

Run: `git diff --check && git status --short`

Expected: 无 whitespace error；只出现本计划列出的文件和用户原有未跟踪文件。

- [ ] **Step 8: 对验证阶段修正做独立提交（仅在有修正时）**

```bash
git add -- apps/agent/src/error apps/agent/src/log apps/agent/src/providers/AIProvider.ts apps/agent/src/providers/AIEvent.ts apps/agent/src/providers/ClaudeCodeProvider.ts apps/agent/src/session/AISession.ts apps/agent/src/session/sessionPaths.ts apps/agent/src/session/SessionStore.ts apps/agent/src/session/SessionRecorder.ts apps/agent/src/session/ResumeManager.ts apps/agent/src/routes/spike.ts apps/agent/src/server.ts apps/agent/src/__tests__/ErrorClassifier.test.ts apps/agent/src/__tests__/RetryStrategy.test.ts apps/agent/src/__tests__/CircuitBreaker.test.ts apps/agent/src/__tests__/SessionLogger.test.ts apps/agent/src/__tests__/GlobalLogger.test.ts apps/agent/src/__tests__/AISession.test.ts apps/agent/src/__tests__/ClaudeCodeProvider.test.ts apps/agent/src/__tests__/sessionPaths.test.ts apps/agent/src/__tests__/SessionStore.test.ts apps/agent/src/__tests__/SessionRecorder.test.ts apps/agent/src/__tests__/ResumeManager.test.ts apps/agent/src/__tests__/spikeRoutes.test.ts packages/shared/src/sse.ts
git commit -m "fix(agent): address P4 verification findings"
```

若验证没有产生修正，不创建空提交。

- [ ] **Step 9: 调用代码审查流程**

执行 `/code-review`，只审查从设计提交 `54a0108` 之后的 P4 实现。对确认的 correctness、取消竞态、slot 泄漏、重复 SSE、敏感日志问题先补 RED 测试，再修复并重跑 Step 1–5。

- [ ] **Step 10: 提交代码审查修正（仅在有修正时）**

```bash
git add -- apps/agent/src/error apps/agent/src/log apps/agent/src/providers/AIProvider.ts apps/agent/src/providers/AIEvent.ts apps/agent/src/providers/ClaudeCodeProvider.ts apps/agent/src/session/AISession.ts apps/agent/src/session/sessionPaths.ts apps/agent/src/session/SessionStore.ts apps/agent/src/session/SessionRecorder.ts apps/agent/src/session/ResumeManager.ts apps/agent/src/routes/spike.ts apps/agent/src/server.ts apps/agent/src/__tests__/ErrorClassifier.test.ts apps/agent/src/__tests__/RetryStrategy.test.ts apps/agent/src/__tests__/CircuitBreaker.test.ts apps/agent/src/__tests__/SessionLogger.test.ts apps/agent/src/__tests__/GlobalLogger.test.ts apps/agent/src/__tests__/AISession.test.ts apps/agent/src/__tests__/ClaudeCodeProvider.test.ts apps/agent/src/__tests__/sessionPaths.test.ts apps/agent/src/__tests__/SessionStore.test.ts apps/agent/src/__tests__/SessionRecorder.test.ts apps/agent/src/__tests__/ResumeManager.test.ts apps/agent/src/__tests__/spikeRoutes.test.ts packages/shared/src/sse.ts
git commit -m "fix(agent): resolve P4 code review findings"
```

最终报告所有测试命令与实际结果；不得把失败或跳过描述为通过。
