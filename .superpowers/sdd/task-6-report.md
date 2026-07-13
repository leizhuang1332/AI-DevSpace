# Task 6: AiSession turn orchestration

## 实现

修改 `apps/agent/src/session/AISession.ts` 把 limiter / retry / cancel / log / resume 串到 #runTurn 上,新增 #runAttempt 子方法做单次 attempt(遇到 error envelope 抛可分类对象,partial output 反馈给 retry 抑制)。

**扩展的类型**

- `SdkUsage`:input / output / cacheRead / cacheCreation 全部可为 null。
- `SdkMessageEnvelope`:
  - `result.usage?: SdkUsage` —— SDK result 携带 token 用量。
  - `error.status?: number` + `error.error?: unknown` —— 携带 transport 状态码与原始 cause。
- `AiSessionDeps`:
  - `initialSdkSessionId?: string` —— 续上下文的初始 SDK session id(首次 send 即用)。
  - `circuitBreaker?: CircuitBreaker` —— Provider 共享的 FIFO 限流器。
  - `retrySleep?: (ms, signal?) => Promise<void>` —— 重试 sleep 钩子(测试可注入)。
  - `sessionLogger?: SessionLogger` —— 每次 query 结束后 logQuery。
  - `onCancelled?: ({localSid, reqId, reason}) => void | Promise<void>` —— 用户取消回调。
  - `nowMs?: () => number` —— 时钟注入(便于测试)。
  - `globalLogger?: GlobalLogger` —— 全局结构化日志(retryExhausted / queryFailed)。

**#runTurn 重写**

1. 联动外部 `signal`:`addEventListener('abort', abortFromExternal, { once: true })` → 转 abort 到内部 controller;finally 中 `removeEventListener` 清理。
2. 装配 system prompt 后进入 retry+limiter 核心:
   - `outputText` 累积 text chunk;
   - `sawOutputWithoutResume` 在没有 resume 情况下已发出 text 时置 true;
   - `circuitBreaker.run(execute, signal)` 排队并把 signal 透传,排队中的 cancel 会立即从队列移除并抛 AbortError。
3. `executeWithRetry`:
   - `canRetry` 检查 `!sawOutputWithoutResume` 与 `__sdkError` 标记(error envelope 不参与 retry);
   - `onRetry` 在 A/C/D 分类时发 `retrying` AIEvent,其他分类不发。
4. catch 块处理 RetryFailure:
   - cancelled → done{reason:'cancelled'}, state='idle', 调 onCancelled;
   - E → status='business_error', state='idle' (用户可继续下一 turn), 不调 globalLogger;
   - A/B/C/D 非重试耗尽 → status='failed', state='errored', 调 retryExhausted / queryFailed;
   - A/C/D 重试耗尽 → 同上 + retryExhausted。
5. finally:清理 signal listener、controller 退役、logQuery(无论成功/失败/cancel 必写一次)。

**#runAttempt**

单次 attempt 跑一次 SDK stream:
- 维护 `env.sessionId` → `this.#sdkSessionId`;
- 遇到 `error` envelope → throw `{__sdkError, code, status, message, cause, recoverable}`(可分类,canRetry 拒重试);
- 遇到 `text` event → `onText(chunk)` + `markOutput()`(触发 sawOutputWithoutResume);
- 遇到 `result` envelope → 返回 `{reason, usage}` 给外层;
- 流自然结束 → 推 done{end_turn}, 返回 `{reason:'end_turn', usage:null}`。

## 文件

- 修改: `apps/agent/src/session/AISession.ts`(23–411 → 11–606,新增 ~200 行)
- 修改: `apps/agent/src/__tests__/AISession.test.ts`(12 → 18 tests,新增 6 个 Task 6 RED 测试)
- 不修改 Task 1–5 产物,不动 `apps/web`。

## 测试命令/结果

```
pnpm --filter @ai-devspace/agent exec vitest run src/__tests__/AISession.test.ts
  → 18/18 PASS (35ms)

pnpm --filter @ai-devspace/agent exec vitest run \
  src/__tests__/ErrorClassifier.test.ts \
  src/__tests__/RetryStrategy.test.ts \
  src/__tests__/CircuitBreaker.test.ts \
  src/__tests__/SessionLogger.test.ts \
  src/__tests__/AISession.test.ts
  → 42/42 PASS (5 files, 950ms)

pnpm --filter @ai-devspace/agent exec vitest run
  → 352/352 PASS (40 files, 9 skipped, 6.99s)

pnpm --filter @ai-devspace/agent typecheck
  → tsc --noEmit: 0 errors

git diff --check
  → no whitespace conflicts
```

## TDD RED/GREEN 证据

**RED(改 AISession.ts 前)**
- 6 个新测试失败:`uses initialSdkSessionId on the first turn` / `retries transient throws and emits retrying before success` / `does not retry auth failures and moves to errored` / `keeps the session idle after an E business error` / `aborts a queued turn and invokes onCancelled without retrying` / `writes one query summary after completion`
- 旧 12 测试中 1 个因 error event 新增 `category` 字段失败 → 改为 `toMatchObject` 兼容。
- 12+1=13 通过 / 6 失败。

**GREEN(改 AISession.ts 后)**
- 18/18 AISession 测试全 PASS,42/42 核心测试 PASS,352/352 全 agent 测试 PASS。

## Self-Review

**1. retry 计数与 A/C/D 调度**
- onRetry 中 `if (cat !== 'A' && cat !== 'C' && cat !== 'D') return` 严格过滤,retrying event 只对 transient 类别发出。B/E/cancelled 不会触发 retrying 事件。
- executeWithRetry 默认 3 次重试,GENERAL_DELAYS = [1000, 3000, 10000],PROCESS_DELAYS = [1000]。attempts 字段由 executeWithRetry 正确填充,logQuery 中能拿到准确 attempt count。

**2. E/B/cancel 分支**
- `failure.classification.category === 'cancelled' || signal.aborted` → done{reason:'cancelled'}, state='idle', onCancelled 触发;E → status='business_error', state='idle', 不调 globalLogger;其他非 E → status='failed', state='errored', globalLogger 区分 retryable 调 retryExhausted 或 queryFailed。

**3. limiter 排队取消**
- circuitBreaker.run(execute, signal) 把 signal 透传到 #acquire 的排队机制,queued waiter 监听 signal abort 后立即从队列移除并 reject AbortError;cancel 触发后,execute 抛 AbortError → catch 走 cancelled 分支 → 推 done{reason:'cancelled'}, state='idle'。排队取消测试通过。

**4. partial output 抑制**
- `markOutput: () => { if (!this.#sdkSessionId) sawOutputWithoutResume = true }` 只在没有 resume 的情况下标记,这是 brief 明确的设计;有 resume 续上下文时即使发了 partial output 仍可重试。`canRetry: () => !sawOutputWithoutResume` 阻止无 resume 时的部分输出重试。
- ⚠ **concern**:有 resume 续上下文时的 partial output 仍可重试,可能产生重复内容。这是 brief 明确边界,生产可考虑更严的 suppression(任何 partial output 后禁止重试),但需确认与已实现 test 兼容。

**5. globalLogger 调用**
- `category !== 'E'` 时:`retryable && retryable` → `retryExhausted`;`!retryable` → `queryFailed`。
- `category === 'E'` (business) → 不调 globalLogger(避免 noise),状态保持 idle。
- ✅ 不漏调,不过度调用。

**6. signal listener 清理**
- 启动时 `addEventListener('abort', abortFromExternal, { once: true })`;finally 块无条件 `removeEventListener('abort', abortFromExternal)`。listener 在每轮都注册/清理,无累积。✅
- 外部 signal 提前 abort 场景:启动时 `if (this.#externalSignal?.aborted) abortFromExternal()` 同步处理;listener 不会注册到已 abort 的 signal,finally 中 `removeEventListener` 是 no-op,正确。

**7. 旧 error event 兼容**
- 新实现中 error event 多出 `category?: Exclude<ErrorCategory, 'cancelled'>` 字段(来自 AIEvent.ts),旧 error envelope 测试用 `toMatchObject` 断言 → 兼容。`recoverable` 字段透传 envelope 的 recoverable,保持原语义。

## Concerns

- ⚠ **partial output 重试边界**:目前 sawOutputWithoutResume 仅在 `!this.#sdkSessionId` 时触发,resume 后发出的 partial 仍可被重试产生重复。Brief 明确该行为,生产如有顾虑可在更上游实现 dedup 逻辑(基于 SDK resume-id + token sequence)。当前实现与 brief 一致。
- ⚠ **error envelope 中 __sdkError marker 是不类型安全的设计**:runAttempt throw 的对象带 `__sdkError: true` marker,canRetry 用 duck-typing 检查。如以后要新增类型安全契约,可改为 `class SdkErrorEnvelope extends Error`,但当前实现最小化、符合 brief。
- ⚠ **SSE/SDK 真实环境下 envelope.error 字段可能很复杂**(可能是 stream 对象、child process 等),`cause: env.error` 透传时类型为 `unknown`,JSON.stringify 可能在 onCancelled / globalLogger 序列化时漏字段(对 globalLogger 接受 `object` 类型是安全的)。
- ✅ typecheck 0 errors,352/352 tests pass,git diff --check 干净。
- ✅ 没修改 apps/web,没动 Task 1–5 产物(ErrorClassifier / RetryStrategy / CircuitBreaker / SessionLogger / GlobalLogger),也没动 AIEvent.ts 等基础设施。
