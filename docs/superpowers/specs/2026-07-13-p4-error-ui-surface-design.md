# P4 错误 UI 暴露(Web 端,workspace 对齐版)

- 日期:2026-07-13
- 对应 issue:`.scratch/feature/sdk-integration/issues/05-p4-errors.md`(Q8.4 段)
- 对应 ADR:`docs/adr/0010-claude-code-sdk-integration.md` Q8
- 承接设计:`docs/superpowers/specs/2026-07-13-p4-error-handling-design.md`
  (已落 Agent 端错误分类/重试/限流/取消/双层日志;**明确把 Web 错误 UI 推迟到本 spec 或 ADR-0009 相关工作**)
- 增量范围:Web 端订阅 Agent 已发出的 `retrying` / `query_failed` / `query_succeeded` / `done` 事件并呈现;
  补 Agent 端 `/sessions/:sid/retry` route;一次性把 `CircuitBreaker` 重命名为 `ProviderSemaphore`

## 1. 背景与目标

承接 `2026-07-13-p4-error-handling-design.md`,该 spec 已完成 Agent 端的错误处理骨架与 typed SSE
契约,但**主动延后**了 Web UI 落地。本次 spec 收口 Web 错误 UI 暴露(Q8.4),对齐项目现有「工位管
理」产品形态(无 Chat 组件;以 ANALYZING/EXECUTING 等工位为交互单元)。

### 1.1 设计决策汇总(用户确认)

| # | 决策点 | 选择 |
|---|---|---|
| D1 | 主战场工位 | **EXECUTING 为主**,ANALYZING 顺手带(已有 err tone chunks 自然呈现) |
| D2 | 重试提示形态 | **StageStrip 徽章 + 内部 Toast** |
| D3 | 重试按钮接线 | **Agent 补 `/sessions/:sid/retry`** + EXECUTING Toolbar 按钮 |
| D4 | CircuitBreaker 重命名 | **一次性重命名**为 `ProviderSemaphore`,无 alias 兼容期 |
| D5 | issue 文档调整 | **同步改** `.scratch/.../05-p4-errors.md` + 写本 spec |

### 1.2 不在 scope(明确划出)

- `/sessions/:sid/cancel` route(本次只消费 `cancelled` 终态,UI 不主动触发)
- Chat 组件(项目无 Chat;走工位对齐路径)
- ANALYZING 工位的 StageStrip 错误徽章(走 thinking stream 的 err chunk 已事实呈现)
- CircuitBreaker 的 deprecated alias(用户选一次性)
- Toast 全局化(只 EXECUTING 用)

### 1.3 验收目标

跑完本 spec 后,issue `05-p4-errors.md` 的所有 checkbox(含 Q8.4)全部勾选,且每项有对应自动化测试。

## 2. 架构总览

```
┌──────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│  Agent 端(改)    │    │  Shared 契约(改) │    │  Web 端(改)         │
├──────────────────┤    ├──────────────────┤    ├────────────────────┤
│ error/           │    │ sse.ts            │    │ executing-zone.tsx  │
│  ProviderSemaphore│◄──│  (补 query_       │───►│  StageStrip 徽章    │
│  (was Circuit    │    │   succeeded)     │    │  Toolbar 重试按钮   │
│   Breaker)       │    │                  │    │  AIEventColumn      │
│                  │    │                  │    │  「已停止」marker   │
│ routes/          │    │                  │    │                    │
│  sessionsRetry   │    │                  │    │ lib/               │
│  Route.ts        │    │                  │    │  useExecutingSse.ts│
│   POST /sessions │    │                  │    │  (SSE 客户端 hook) │
│   /:sid/retry    │    │                  │    │                    │
│                  │    │                  │    │ components/        │
│ session/         │    │                  │    │  toast.tsx         │
│  AISession.ts    │    │                  │    │  toast-host.tsx    │
│   + last_input   │    │                  │    │  (右下角 Toast 容器)│
│   + isRetry      │    │                  │    │                    │
└──────────────────┘    └──────────────────┘    └────────────────────┘
```

**核心数据流**:
1. SDK 抛 A/C/D 错 → Agent `executeWithRetry.onRetry` → `AIEvent{type:'retrying'}` → SSE Hub publish
2. 重试用尽或 B/E 永久错 → SSE `query_failed` + `done{reason:'error'}`
3. 成功 → SSE `query_succeeded` + `done{reason:'end_turn'}`
4. 用户取消 → `done{reason:'cancelled'}`
5. Web `useExecutingSse` 订阅 → reducer 维护 5 态(`idle | running | retrying | failed | cancelled`)
6. EXECUTING StageStrip/Toolbar/AIEventColumn 据状态渲染
7. 用户点重试 → Web POST `/sessions/:sid/retry` → Agent 读 `meta.last_input` 重发(isRetry=true 时首 retry 间隔=0)

## 3. 组件契约

### 3.1 Agent:`error/ProviderSemaphore.ts`(原 CircuitBreaker.ts)

**机械重命名**,类实现保持不变(现有 3 个测试逻辑零改动通过)。仅:
- 文件名 + 类名 + 导出名替换
- 现有头部注释升级:把「Despite the historical name `CircuitBreaker`」段替换为正面描述「Provider-scoped FIFO concurrency semaphore,enforces per-Provider in-flight limit」

**改动文件清单**:
- `apps/agent/src/error/CircuitBreaker.ts` → 删除
- `apps/agent/src/error/ProviderSemaphore.ts` → 新建(内容复制 + 注释更新)
- `apps/agent/src/__tests__/CircuitBreaker.test.ts` → 删除
- `apps/agent/src/__tests__/ProviderSemaphore.test.ts` → 新建(原内容 + describe 名改)
- `apps/agent/src/providers/ClaudeCodeProvider.ts` → import + 1 处实例化改名
- `apps/agent/src/session/AISession.ts` → import + DI 字段改名
- `apps/agent/src/server.ts` → import + 1 处实例化改名

### 3.2 Agent:新 route `POST /sessions/:sid/retry`

**文件**:`apps/agent/src/routes/sessionsRetryRoute.ts`(新建)

**契约**:
```ts
// 请求
POST /sessions/:localSid/retry
Content-Type: application/json
{ reqId: string, runId?: string }

// 200 OK
{ retryToken: string, runId: string }

// 409 Conflict — 没有可重试的 last input
{ error: 'no_retryable_input', message: string }

// 404 Not Found — session 不存在
{ error: 'session_not_found', message: string }
```

**行为**:
1. 从 SessionStore 取 session meta,读 `last_input` 字段
2. 若 `last_input` 为空/undefined → 409 `no_retryable_input`
3. 若 session 不存在 → 404 `session_not_found`
4. 否则构造 retry 上下文,调 `AISession.runTurn({ inputText: last_input, signal: new AbortController().signal, isRetry: true })`
5. 返回 `{ retryToken, runId }`,Web 端用 `retryToken` 重新订阅 SSE 频道

### 3.3 Agent:`AISession.runTurn` 加 `isRetry` 入参

**改动**(`apps/agent/src/session/AISession.ts`):
- `runTurn` 入参加 `isRetry?: boolean`
- 若 `isRetry=true`,调用 `executeWithRetry` 时传入 `initialDelayMs: 0`(使首 retry 间隔=0,语义上「重试不该再等 1s 起步」)
- `RetryStrategy.executeWithRetry` 加新参数 `initialDelayMs?: number`(默认 1000,保持现有 A/D 路径行为)
- `AISession` 每次 send 成功后,把 `inputText` 写入 `meta.yaml.last_input`(SessionStore.updateSession 调用点加一行)

**语义保证**:
- 非 retry 路径:`initialDelayMs` 不传,退避序列仍为 `[1000, 3000, 10000]`,现有测试零改动通过
- retry 路径:`initialDelayMs: 0`,退避序列变为 `[0, 3000, 10000]`,RetryStrategy 单测加用例覆盖

### 3.4 Shared:`packages/shared/src/sse.ts` 补 `query_succeeded`

**新增 1 个变体**:
```ts
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

**用途**:Web 端 reducer 收到此事件后把状态从 `retrying`/`running` 重置为 `idle`(清空 StageStrip 徽章 + Toolbar 重试按钮)。

**已有变体不变**:`retrying`(category A/C/D,retry/maxRetries/delayMs 可 null)、`query_failed`(category A-E,code,message)保持现状。

### 3.5 Web:`lib/useExecutingSse.ts` hook

**契约**:
```ts
export type ExecutingAiStatus =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: string }
  | { kind: 'retrying'; category: 'A' | 'C' | 'D'; retry: number; maxRetries: number; delayMs: number; startedAt: string }
  | { kind: 'failed'; category: 'A' | 'B' | 'C' | 'D' | 'E'; code: string; message: string; failedAt: string }
  | { kind: 'cancelled'; reason: string; cancelledAt: string }

export interface UseExecutingSseOptions {
  reqId: string
  sessionId: string | null  // null = 还没启动
  enabled: boolean          // 工位是否在该页面
}

export function useExecutingSse(opts: UseExecutingSseOptions): {
  status: ExecutingAiStatus
  retry: () => Promise<void>  // 抛出错误时由调用方 push toast
  cancel: () => Promise<void>  // 本期 no-op,return undefined
}
```

**reducer 状态转换表**(显式):

| 当前状态 | 收到事件 | 下一状态 |
| --- | --- | --- |
| `idle` | `running` 标志(本期由父组件在 `send()` 触发时设置) | `running` |
| `running` | SSE `retrying` | `retrying` |
| `running` | SSE `query_succeeded` 或 `done{reason:'end_turn'}` | `idle` |
| `running` | SSE `query_failed` 或 `done{reason:'error'}` | `failed` |
| `running` | SSE `done{reason:'cancelled'}` | `cancelled` |
| `retrying` | SSE `retrying`(后续重试) | `retrying`(更新 retry/maxRetries) |
| `retrying` | SSE `query_succeeded` | `idle` |
| `retrying` | SSE `query_failed` | `failed` |
| `retrying` | SSE `done{reason:'cancelled'}` | `cancelled` |
| `failed` | 用户点重试(调用 `retry()` 成功后) | `running`(新 runId) |
| `cancelled` | 用户点重试(调用 `retry()` 成功后) | `running`(新 runId) |
| 任意 | 事件 `runId` 与当前不匹配 | **丢弃**(防 stale) |

**实现要点**:

- 内部 `useReducer`,初始 `{ kind: 'idle' }`
- `enabled && sessionId` 时 `new EventSource(...)`,cleanup 时 `close()`
- `retry()` 内部:`fetch POST /sessions/:sid/retry`(5s 超时);成功 → 旧 EventSource close → 新 EventSource open → reducer 收新 runId 事件;**失败抛 Error,由调用方 push `err` tone toast「重试请求失败」**(hook 不直接管 toast)
- 严格 cleanup 顺序:旧 EventSource close → 新 EventSource open,避免双重订阅
- 旧 `runId` 的迟到事件丢弃(防 stale,见转换表最后一行)

### 3.6 Web:`components/toast.tsx` + `toast-host.tsx`

**Toast 组件**:
```ts
export interface ToastItem {
  id: string
  message: string
  tone: 'info' | 'warn' | 'err'
  /** null = 不自动消失(用户手动关) */
  durationMs: number | null
}

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): JSX.Element
```

- 内部 `useEffect`:若 `durationMs !== null` 则 `setTimeout(onDismiss, durationMs)`,unmount 清理
- 右下角 fixed 定位,fade-in/fade-out 200ms CSS transition
- 文案带 ✕ 关闭按钮(aria-label="关闭通知")

**ToastHost 组件**:
- props:`items: ToastItem[]; onDismiss: (id: string) => void`
- 内部堆叠渲染 Toast,从下往上新进旧退
- 只在 EXECUTING 页面顶层挂载(随组件 unmount 自动清空)

### 3.7 EXECUTING 组件改动(`apps/web/src/components/executing-zone.tsx`)

**StageStrip 入参扩展**:
```ts
function StageStrip({ stage, status }: { stage: StageData; status: ExecutingAiStatus })
```
- `status.kind === 'retrying'` → 黄底徽章「⚠️ 重试中 {retry}/{maxRetries}({category})」+ `animate-pulse`
- `status.kind === 'failed'` → 红底徽章「❌ 失败 · {category} · {code}」
- `status.kind === 'cancelled'` → 灰底徽章「⏸ 已停止」
- 其他 → 不显示徽章
- testid: `executing-stage-status` + `data-status={status.kind}`

**Toolbar 入参扩展**:
```ts
function Toolbar({ toolbar, onRetry, canRetry }: { toolbar: ToolbarData; onRetry: () => void; canRetry: boolean })
```
- `canRetry === true` 时在 `actions` 数组前插入 `{ variant: 'danger', label: '🔄 重试', onClick: onRetry }`
- 其他情况不变

**AIEventColumn 入参扩展**:
```ts
function AIEventColumn({ events, cancelledAt }: { events: AIEvent[]; cancelledAt: string | null })
```
- `cancelledAt !== null` 时,在 events 列表末尾追加 marker 行:
  - tone: `warn`
  - action: `⏸ 已停止`
  - ts: `cancelledAt`
  - testid: `executing-ai-event-cancelled-marker`

**ExecutingZone 顶层接线**:
```ts
export function ExecutingZone({ data }: { data: ExecutingData }) {
  // ExecutingData 扩展(本期 spec 内做):
  //   - 新增可选字段 sessionId?: string | null(本期 server 端注入;
  //     真实接线下一 slice 由 RSC 拉取 SessionStore 填充;无值时退化为 null,
  //     useExecutingSse 内部不订阅,UI 徽章/按钮退化为初始 idle)
  //   - 新增可选字段 reqId?: string(默认取 data.requirementId)
  const sessionId = data.sessionId ?? null
  const reqId = data.reqId ?? data.requirementId
  const { status, retry } = useExecutingSse({ reqId, sessionId, enabled: true })
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // status 变化时推 toast:retrying 进入时
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
    <main>
      <StageStrip stage={data.stage} status={status} />
      <Toolbar toolbar={data.toolbar} onRetry={handleRetry} canRetry={status.kind === 'failed'} />
      <div>
        <DagColumn ... />
        <DiffColumn ... />
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

**ExecutingData 扩展的 type 改动**(`apps/web/src/lib/executing.ts`):
```ts
export interface ExecutingData {
  // ... 既有字段保持不变
  requirementId: string
  empty: boolean
  stage: StageData
  toolbar: ToolbarData
  dag: { tasks: DagTask[]; block: { title: string; meta: string } }
  diff: { files: DiffFile[]; cumulativeText: string }
  aiEvents: AIEvent[]
  // 本期新增(可选):
  sessionId?: string | null  // null = 还没启动 query;undefined = mock 数据
  reqId?: string             // 默认从 requirementId 取
}
```

## 4. 数据流时序

### 4.1 失败重试完整路径

```text
时间轴
─────────────────────────────────────────────────────────────────────
Web                          Agent                          SDK
─────────────────────────────────────────────────────────────────────
用户输入 q
                              ← runTurn(text=q)
                              ← executeWithRetry(operation)
                              → operation() ────────────► SDK.query(q)
                                                           ↓ 抛 RateLimitError
                              ← classifyError → 'A'
                              ← onRetry callback
                              → AIEvent{type:'retrying'}
                              → SSE publish ──────────► EventSource.onmessage
← status = retrying {1/3}                                   │
← StageStrip 徽章 ⚠️ 重试中 1/3(A)                          │
← Toast: 连接异常,重试中 1/3                                 │
                              → sleep(1000)
                              → operation() retry 2 ─────► SDK.query(q)
                                                           ↓ 抛 RateLimitError
                              ← onRetry callback
                              → SSE publish ──────────►
← status = retrying {2/3}                                   │
                              → sleep(3000)
                              → operation() retry 3 ─────► SDK.query(q)
                                                           ↓ 抛 AuthError
                              ← classifyError → 'B'
                              ← maxRetries exhausted
                              → SSE query_failed(category:B)
                              → SSE done{reason:'error'} ─►
← status = failed {B, 401}                                  │
← StageStrip 徽章 ❌ 失败 · B · 401                         │
← Toolbar 新增 [🔄 重试] 按钮                                │
                              ...
用户点 [🔄 重试]
POST /sessions/s-123/retry  →                                │
                              → 读 meta.last_input = q      │
                              → AISession.runTurn({        │
                                    inputText: q,           │
                                    isRetry: true           │
                                  })                        │
                              → executeWithRetry            │
                                initialDelayMs=0            │ ← 关键
                              → operation() ──────────────► SDK.query(q)
                                                           ↓ 正常返回
                              → SSE query_succeeded
                              → SSE done{reason:'end_turn'} ►
← status = idle                                             │
← StageStrip 徽章消失                                       │
← Toolbar 重试按钮消失                                      │
─────────────────────────────────────────────────────────────────────
```

### 4.2 取消路径(cancelled 终态可被消费,UI 不主动触发)

```text
                              ← AISession.cancel()(其他入口,如 SDK timeout)
                              ← internalController.abort()
                              ← classifyError → 'cancelled'
                              → SSE done{reason:'cancelled'} ─►
← status = cancelled {reason:'user'}                        │
← StageStrip 徽章 ⏸ 已停止                                  │
← AIEventColumn 末尾追加 marker: ⏸ 已停止 · 14:23:05       │
← Toolbar 重试按钮可用                                      │
─────────────────────────────────────────────────────────────────────
```

## 5. 测试策略

### 5.1 分层测试

| 层 | 文件 | 验证目标 |
|---|---|---|
| L1 纯函数 | `ProviderSemaphore.test.ts`(原 CircuitBreaker) | 改名后既有 3 个测试逻辑零改动通过 |
| L1 纯函数 | `RetryStrategy.test.ts`(扩) | `initialDelayMs=0` 时首 retry 间隔为 0 |
| L1 纯函数 | `useExecutingSse.test.ts` | reducer 转换 + retry fetch 调用 |
| L1 纯函数 | `toast.test.tsx` | 自动消失 + unmount 清理 + 关闭按钮 |
| L2 组件 | `executing-zone.test.tsx`(扩) | 4 种 status 渲染 + 重试按钮显隐 + cancelled marker |
| L2 组件 | `toast-host.test.tsx` | 堆叠进出 + dismiss 回调 |
| L3 路由 | `sessionsRetryRoute.test.ts` | 200/409/404 + isRetry 退避起点 |
| L3 集成 | `agent-skeleton.e2e.test.ts`(扩) | retrying → query_failed → /retry → query_succeeded |

### 5.2 TDD 顺序

严格按「红 → 绿 → 重构」:
1. `ProviderSemaphore.test.ts` 新 import → 改名实现 → 绿
2. `RetryStrategy.test.ts` 加 `initialDelayMs=0` 用例 → 改 RetryStrategy → 绿
3. `sessionsRetryRoute.test.ts`(先 409 路径)→ 实现 route → 绿
4. `useExecutingSse.test.ts` reducer 纯转换 → 实现 hook → 绿
5. `toast.test.tsx` → 实现 → 绿
6. `executing-zone.test.tsx` StageStrip 徽章 → 改 StageStrip → 绿
7. `executing-zone.test.tsx` Toolbar 重试按钮 → 改 Toolbar → 绿
8. `executing-zone.test.tsx` AIEventColumn cancelled marker → 改 AIEventColumn → 绿
9. `agent-skeleton.e2e.test.ts` 全链路 → 跑全量 → 绿

### 5.3 验收前必跑命令

```
cd apps/agent && npx vitest run              # Agent 单测
cd apps/web && npx vitest run                # Web 单测
pnpm tsc --noEmit                            # 类型检查
```

`next build` **本期不跑**(遵循 CLAUDE.md dev/build 隔离规则;仅 PR 前跑一次)。

## 6. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| rename 漏掉 import | 中 | 编译失败 | Step 1 先 `grep -r "CircuitBreaker" apps/ packages/` 确保 0 命中 |
| isRetry 首 retry 间隔改坏现有路径 | 中 | 影响所有调用方 | RetryStrategy 加 `initialDelayMs?: number`(默认 1000),仅 isRetry 路径传 0 |
| Web SSE 重连竞态 | 高 | 双重订阅 | useExecutingSse 严格 cleanup → new 顺序;旧 runId 迟到事件丢弃 |
| ToastHost 切 tab 不消失 | 中 | 内存泄漏 | 只在 EXECUTING 挂载;unmount 时清理 setTimeout |
| /retry 后 SSE 连不上 | 低 | 用户无反应 | retry() 5s 超时 + 失败 toast |
| dev/build 隔离被破坏 | 低 | dev 服 CSS 404 | 验证只跑 vitest + tsc --noEmit |
| EXECUTING 测试 mock EventSource 脆弱 | 中 | 维护成本 | 抽 `createMockEventSource()` helper 到 `__tests__/__helpers__/` |

## 7. 改动文件清单

### 7.1 Agent 端

| 文件 | 操作 | 估算行数 |
|---|---|---|
| `src/error/CircuitBreaker.ts` | 删除 | -99 |
| `src/error/ProviderSemaphore.ts` | 新建 | +99 |
| `src/__tests__/CircuitBreaker.test.ts` | 删除 | -47 |
| `src/__tests__/ProviderSemaphore.test.ts` | 新建 | +47 |
| `src/error/RetryStrategy.ts` | 加 `initialDelayMs` 参数 | ±8 |
| `src/__tests__/RetryStrategy.test.ts` | 加用例 | +30 |
| `src/providers/ClaudeCodeProvider.ts` | 改 import + 实例化 | ±2 |
| `src/session/AISession.ts` | 改 import + DI 字段改名 + `isRetry` + `last_input` 写入 | ±20 |
| `src/server.ts` | 改 import + 实例化 + 注册新 route | ±5 |
| `src/routes/sessionsRetryRoute.ts` | 新建 | +120 |
| `src/__tests__/sessionsRetryRoute.test.ts` | 新建 | +150 |
| `src/__tests__/agent-skeleton.e2e.test.ts` | 扩 retrying/query_failed/retry 用例 | +60 |

### 7.2 Shared

| 文件 | 操作 | 估算行数 |
|---|---|---|
| `src/sse.ts` | 加 `query_succeeded` 变体 | +18 |

### 7.3 Web 端

| 文件 | 操作 | 估算行数 |
|---|---|---|
| `src/lib/useExecutingSse.ts` | 新建 | +140 |
| `src/lib/__tests__/useExecutingSse.test.ts` | 新建 | +180 |
| `src/components/toast.tsx` | 新建 | +90 |
| `src/components/__tests__/toast.test.tsx` | 新建 | +120 |
| `src/components/toast-host.tsx` | 新建 | +50 |
| `src/components/__tests__/toast-host.test.tsx` | 新建 | +80 |
| `src/components/executing-zone.tsx` | StageStrip/Toolbar/AIEventColumn 扩展 + 顶层 hook 接线 | +90 |
| `src/__tests__/executing-zone.test.tsx` | 扩 4 个 status 用例 | +150 |

### 7.4 Issue 文档

| 文件 | 操作 |
|---|---|
| `.scratch/feature/sdk-integration/issues/05-p4-errors.md` | checkbox 勾选 + 验收 section 重写 |

**总计**:8 新建 + 6 改动 + 2 删除,约 +1400 / -200 行

## 8. 实施顺序(8 步,每步独立可测可提交)

```
Step 1: ProviderSemaphore 重命名(无逻辑改动)
Step 2: AISession.last_input 持久化 + isRetry 入参
Step 3: sessionsRetryRoute 新建
Step 4: Shared sse.ts 加 query_succeeded
Step 5: useExecutingSse hook(TDD)
Step 6: Toast + ToastHost 组件(TDD)
Step 7: EXECUTING 组件接线(TDD)
Step 8: 端到端验收 + issue 文档同步
```

每步完成时本地跑 `vitest run` + `tsc --noEmit`,全绿后才 commit。

**估时**:Step 1-4(Agent + Shared)= 0.5 周;Step 5-7(Web)= 1 周;Step 8(e2e + 文档)= 0.5 天;**合计 ~1.5 周**。
