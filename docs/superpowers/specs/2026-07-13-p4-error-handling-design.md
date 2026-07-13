# P4 错误处理设计

- 日期：2026-07-13
- 对应 issue：`.scratch/feature/sdk-integration/issues/05-p4-errors.md`
- 对应 ADR：`docs/adr/0010-claude-code-sdk-integration.md` Q8
- 实施范围：Agent 后端错误处理与 typed SSE 契约；不实现 Web 错误 UI

## 1. 背景与目标

本设计为 Claude Agent SDK 集成增加统一的错误分类、重试、取消、per-Agent 并发限制和双层日志，并补齐 P3 持久化在真实 query 生命周期中的接线。

需要满足以下行为：

- 将错误分为 A–E 五类；
- A/D 最多追加重试 3 次，固定退避 1s、3s、10s；
- C 仅追加重试 1 次；
- B/E 和用户取消不重试；
- 每次重试发出 typed `retrying` 事件；
- 每个 `ClaudeCodeProvider` 最多同时运行 5 个完整 query，超出后 FIFO 等待；
- 取消运行中的 SDK query，并将 partial output 标为 incomplete；
- per-session 写 `log.jsonl`，全局系统事件继续写 `~/.aidevspace/logs/agent.log`；
- 修复已有 resume、cwd 和外部 signal 接线缺口。

Issue 05 同时列出 Web Toast、StatusBar、失败条和重试按钮，但 SDK Integration PRD 明确将 Web 集成排除在当前范围外。本次只定义后端 typed SSE 契约；UI 留给 ADR-0009 相关工作或 issue 06。

## 2. 方案选择

### 2.1 采用：在 AISession turn 执行层统一编排

`ClaudeCodeProvider` 继续负责 SDK 参数和 raw message 适配；`AISession` 负责一次 `send()` 的运行生命周期，并通过注入组件执行错误分类、退避重试、取消和并发门控。

Provider 实例持有共享 limiter，因此它创建的所有 session 共同遵守 per-Agent 5 并发上限。`SessionRecorder` 和 `SessionLogger` 消费稳定业务事件或生命周期回调，不让 `AISession` 直接访问文件系统。

### 2.2 未采用：RetryingProvider 装饰器

该方案能保持 `AISession` 较小，但会代理完整 session 生命周期，使 SDK session ID、partial output、取消和恢复状态分散到两层。对当前代码规模属于过度抽象。

### 2.3 未采用：Fastify route 层编排

route 层实现会使非 HTTP 调用绕过重试和限流，并将 SDK 运行语义耦合到传输层。route 应只负责把稳定 `AIEvent` 映射为 SSE。

## 3. 组件与职责

### 3.1 ErrorClassifier

新增 `apps/agent/src/error/ErrorClassifier.ts`。

分类结果至少包含：

- 分类：A、B、C、D、E 或 cancelled；
- 是否可重试；
- 稳定 public code；
- 可安全记录的诊断信息；
- 原始错误引用，仅供内部日志使用。

分类按以下顺序执行：

1. 用户取消；
2. E 类业务错误；
3. C 类进程错误；
4. D 类网络/IO；
5. A/B 类 API 错误；
6. 未知错误默认归 B。

具体规则：

- cancelled：`AbortSignal.aborted`、`AbortError` 或 SDK 明确取消状态；
- E：`error_max_turns`、Agent 主动放弃等业务终止；
- C：spawn 失败、`ENOENT`、`EACCES`、CLI 非零退出码；
- D：`ECONNRESET`、`ECONNREFUSED`、`EPIPE`、`ENOTFOUND`、socket timeout；
- A：429 rate limit、408、5xx、API request timeout；
- B：认证、权限、billing/quota exhausted、无效请求和其他永久 4xx。

quota/billing 信号先于通用 429 判断，防止将额度耗尽误判为瞬时限流。优先读取结构化 `status`、`code`、`type`、`cause` 和退出码；仅在 SDK/CLI 未提供结构化字段时回退到消息文本匹配。

未知错误默认不重试，避免盲目重复有副作用的请求。

### 3.2 RetryStrategy

新增 `apps/agent/src/error/RetryStrategy.ts`。

规则：

- A/D：retry schedule 为 `[1000, 3000, 10000]`；
- C：retry schedule 为 `[1000]`；
- B/E/cancelled：空 schedule；
- 不添加 jitter，以严格满足验收；
- “最多 3 次”解释为初始调用之后追加 3 次重试，A/D 最多执行 4 次 SDK attempt；
- 每次 retry 前调用 `onRetry`，随后 sleep，再开始下一 attempt；
- `sleep` 通过依赖注入，单测不真实等待。

重试事件结构：

```ts
{
  type: "retrying",
  category: "transient_api" | "process" | "network_io",
  retry: number,
  maxRetries: number,
  delayMs: number,
  message: string
}
```

如果 SDK 已提供 session ID，下一 attempt 必须使用该 ID resume。若已向消费者发出 partial output，但没有可恢复的 SDK session ID，则停止自动重放，将当前 turn 标为 incomplete，避免重复 prompt 或重复输出。

### 3.3 CircuitBreaker

新增 `apps/agent/src/error/CircuitBreaker.ts`。

为保持 issue/ADR 命名，文件名使用 `CircuitBreaker`；实现和注释必须明确其语义是 FIFO concurrency semaphore，不是传统按失败率开路的 circuit breaker。

行为：

- 默认容量 5；
- 前 5 个 query 立即获得 slot；
- 后续 query 严格 FIFO 等待；
- slot 覆盖一次用户 query 的完整生命周期，包括 retry backoff；
- 成功、失败和取消均在 finally 中释放 slot；
- 排队等待者可通过 AbortSignal 取消并从队列移除；
- 取消等待者不会消耗 slot，也不会破坏剩余 FIFO 顺序。

Q4 `WriteQueue` 与此组件保持正交：前者按 reqId 串行写操作，后者在 Provider 全局限制完整 SDK query 数。

### 3.4 SessionLogger

新增 `apps/agent/src/log/SessionLogger.ts`，并在 session path 中增加 `log.jsonl`。

每次 `send()` 最终追加一条结构化记录：

```ts
interface SessionQueryLog {
  timestamp: string
  localSid: string
  reqId: string
  durationMs: number
  attempts: number
  retryDelaysMs: number[]
  status: "succeeded" | "failed" | "cancelled" | "business_error"
  input: {
    preview: string
    characters: number
    truncated: boolean
  }
  output: {
    preview: string
    characters: number
    truncated: boolean
    incomplete: boolean
  }
  tokens: {
    input: number | null
    output: number | null
    cacheRead: number | null
    cacheCreation: number | null
  }
  error: {
    category: "A" | "B" | "C" | "D" | "E" | null
    code: string | null
    message: string | null
  }
}
```

日志策略：

- input/output preview 默认最多 2,000 字符；
- 对 API key、Bearer token 和常见 secret assignment 做脱敏；
- 不记录完整 system prompt、环境变量或完整工具结果；
- token 仅记录 SDK 明确返回的数据，缺失时写 `null`，不估算；
- append 失败不改变 query 结果，只向 GlobalLogger 报告。

### 3.5 GlobalLogger

新增 `apps/agent/src/log/GlobalLogger.ts`，定义轻量 logger port 并适配现有 Pino/Fastify logger。

记录事件：

- `agent_started`；
- `agent_stopped`；
- `config_changed`；
- `query_retry_exhausted`；
- `session_log_write_failed`；
- 其他跨 session 系统错误。

实际文件仍由现有 Pino transport 写到 `~/.aidevspace/logs/agent.log`，不得再创建第二个竞争 writer。测试使用内存 sink。

## 4. Query 数据流

```text
send(prompt)
  -> 获取 Provider 共享并发 slot
  -> 开始 attempt
  -> SDK query
  -> SDK envelope 或 thrown error
  -> ErrorClassifier
  -> RetryStrategy
       -> emit AIEvent.retrying
       -> sleep
       -> 使用最新 SDK session ID resume
  -> emit text/tool/error/done
  -> SessionRecorder + SessionLogger
  -> finally 释放并发 slot
```

退避期间继续占用 slot，避免服务异常时等待队列外产生大量并发重试。

## 5. 取消与状态机

取消来源：

- `AISession.cancel()`；
- `CreateSessionOptions.signal`；
- 等待并发 slot 时的 AbortSignal。

处理顺序：

1. 排队任务从 FIFO 队列移除，或运行任务调用当前 turn 的 `AbortController.abort()`；
2. 取消不进入 retry；
3. 已累积文本由 `SessionRecorder` 写入 `messages.jsonl`，标记 `incomplete: true`；
4. 上层生命周期回调通过 `SessionStore.updateSession()` 写 `last_cancel_at`；
5. 发出 `done { reason: "cancelled" }` 和 typed cancelled SSE；
6. session 回到 `idle`；
7. 释放并发 slot。

`AISession` 不直接写文件。取消时间由拥有 `SessionStore` 的 orchestrator/ResumeManager 更新。

失败后的状态：

- E 类业务错误：当前 turn 结束，session 回到 `idle`，允许继续下一轮；
- 用户取消：session 回到 `idle`；
- B 类永久错误或 A/C/D 重试耗尽：session 进入 `errored`；
- 从 `errored` 恢复时，由 `ResumeManager` 创建新的运行实例并复用 local session 和 SDK session ID，不静默重置损坏实例。

## 6. Resume、cwd 和 signal 修复

本次同时修复已发现的 P3/P0 接线缺口：

- `createSession({ resume })` 初始化 `AISession` 的 SDK session ID；
- retry 使用当前最新 SDK session ID；
- `createSession({ cwd })` 真正传给 SDK，不再固定使用 `process.cwd()`；
- `CreateSessionOptions.signal` 与每轮 AbortController 联动；
- `ResumeManager` 创建 session 后接入 `SessionRecorder` 和取消元数据更新。

## 7. 事件契约

### 7.1 AIEvent

在不修改既有成员字段的前提下新增 `retrying` variant。现有 `error` variant增加可选分类信息：

- category；
- retryable；
- stable code。

E 类业务错误仍通过稳定业务事件流出，而不是泄漏 SDK raw error。

### 7.2 SSEEvent

共享 SSE union 新增：

- `retrying`；
- `query_failed`；
- `query_cancelled`。

事件携带 `reqId` 和 `sessionId`，兼容当前 requirement channel，并为 issue 06 的 per-session SSE 升级保留稳定契约。

当前 spike route 改为 `AIEvent -> SseEvent` 的 typed 映射，不再将 JSON 塞入 `placeholder.message`。本次不扩展成正式 Web chat API。

## 8. 持久化接线

- `sessionPaths` 增加 `log` 路径；
- `SessionMeta` 增加可选 `last_cancel_at`；
- `SessionRecorder` 继续作为 `messages.jsonl` 的唯一 partial/incomplete writer；
- `SessionLogger` 记录 query 汇总，不重复实现消息镜像；
- `ResumeManager` 传递 resume ID、接入 recorder，并在取消时更新 meta；
- SDK usage 字段存在时映射为可选内部 usage，供 SessionLogger 使用。

## 9. TDD 与验证

### 9.1 ErrorClassifier

覆盖：

- 429、5xx、request timeout -> A；
- auth、permission、billing/quota、永久 4xx -> B；
- spawn/CLI exit -> C；
- socket/连接错误 -> D；
- `error_max_turns`/主动放弃 -> E；
- AbortError -> cancelled；
- 未知错误 -> B。

### 9.2 RetryStrategy

覆盖：

- A/D 延迟严格为 1s、3s、10s；
- C 仅重试一次；
- B/E/cancelled 不重试；
- retry event 的次数、总数和 delay 正确；
- 最终返回成功值或原始失败；
- fake sleep，无真实 14 秒等待。

### 9.3 CircuitBreaker

覆盖：

- 前 5 个任务并行；
- 第 6 个等待；
- 释放后严格 FIFO；
- rejection 释放 slot；
- 排队中取消移除等待者；
- active 永不超过 5。

### 9.4 Logger

覆盖：

- JSONL schema 和追加顺序；
- preview 截断、敏感字段脱敏；
- token 缺失写 `null`；
- SessionLogger 写失败不覆盖 query 结果；
- Pino adapter 事件结构正确。

### 9.5 AISession 与 Provider

覆盖：

- rate limit 后成功及 retry 耗尽；
- auth fail 立即失败；
- process error 只 retry 一次；
- retry 使用最新 SDK session ID；
- retrying/error/done 事件顺序；
- 取消不 retry，并释放 slot；
- 外部 signal 生效；
- 从磁盘恢复后的首次 query 使用 resume ID；
- E 类错误后 session 可继续下一轮。

### 9.6 持久化与 route

覆盖：

- cancel 更新 `last_cancel_at`；
- partial message 写 `incomplete: true`；
- 每个 query 产生一条 `log.jsonl`；
- SSE 输出 typed retry/failure/cancel event，不借用 placeholder。

验证节奏：

- 每完成一个组件运行对应测试文件；
- 定期运行 Agent TypeScript typecheck；
- 完成后运行 Agent 全套测试；
- 最终运行仓库全套测试；
- 本次不改 Web，不运行 Next build；若 dev server 正在运行，任何情况下也不与 `next build` 共用 `.next`。

## 10. 非目标

本次不包含：

- Web Toast、StatusBar、失败条、重试按钮和停止标记；
- issue 06 的完整 per-session SSE 路由升级和指标聚合；
- 传统失败率开路/半开恢复式 circuit breaker；
- 日志轮转、上传和长期 retention；
- 对真实 Anthropic API 制造 rate limit 或 auth failure；
- 修改工作区中现有未跟踪的 drafting 设计文件。
