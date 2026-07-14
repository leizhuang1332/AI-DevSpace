---
Status: ready-for-agent
Type: task
Stage: P4
---

# 05 - P4 错误处理：ErrorClassifier + RetryStrategy + ProviderSemaphore

## 目标

落地 ADR-0010 Q8（错误处理）：5 类错误分类、退避重试、AbortController 取消、per-Agent in-flight 限流、双层日志。

## 范围

- [x] `error/ErrorClassifier.ts` — 5 类分类
  - A SDK API 瞬时（rate limit / 5xx / timeout）→ 重试
  - B SDK API 永久（auth fail / quota exhausted）→ 立即报
  - C 进程错误（spawn fail / CLI exit ≠ 0）→ 重试 1 次
  - D 网络/IO（连接断 / socket timeout）→ 重试
  - E 业务错误（`error_max_turns` / agent 主动放弃）→ 不重试
- [x] `error/RetryStrategy.ts` — 退避重试
  - 指数退避：1s / 3s / 10s
  - 最大 3 次
  - A/C/D 重试，B/E 不重试
  - 每次重试状态推 SSE（`retrying` 事件 + 当前次数 / 总次数）
  - `initialDelayMs` 入参支持 retry-of-retry 跳过首退避
- [x] `error/ProviderSemaphore.ts` — per-Agent 全局 in-flight 上限（原 CircuitBreaker,2026-07-13 重命名）
  - 上限 5 个并发 query
  - 超过 → FIFO 等待队列
  - 与 Q4 写队列**职责正交**（Q4 是 per-req 写操作,ProviderSemaphore 是 per-Agent 全局）
- [x] AbortController 取消（Q8.2）：
  - 用户点「停止」→ Agent 调 `AbortController.abort()`
  - SDK 优雅清理子进程
  - 已收到的部分写 messages.jsonl 标 `incomplete: true`
  - meta.yaml 加 `last_cancel_at`
- [x] 错误 UI 暴露（Q8.4,2026-07-14 落地）：
  - 重试中 → StageStrip 渲染「⚠️ 重试中 N/M(category)」徽章 + Toast「⚠️ 连接异常,重试中 N/M」
  - 重试失败 / B 永久错误 → StageStrip 红徽章「❌ 失败 · 分类 · code」+ Toolbar 出现「🔄 重试」按钮
  - E 业务错误 → 自然出现在 chat 流
  - 用户取消 → AIEventColumn 末尾追加「⏸ 已停止 (cancelledAt)」marker
  - retry route:`POST /sessions/:sid/retry` 读 `meta.yaml.last_input` 回放,409 缺 last_input / 200 + retryToken
- [x] `log/SessionLogger.ts` — per-session `log.jsonl`
  - 每次 query 记录：input / output / error / tokens / 耗时
- [x] `log/GlobalLogger.ts` — `~/.aidevspace/logs/agent.log`
  - 跨 session 系统级错误
  - Agent 启动 / 关闭 / 配置变更

## 验收（workspace 对齐版）

> 来源:plan `2026-07-13-p4-error-ui-surface-plan.md` §1.3,workspace 自审后采纳

- [x] **Retry 退避默认行为**:mock rate limit → Agent 自动重试 3 次（1s / 3s / 10s 间隔），每次 Toast 提示 + StageStrip `data-status="retrying"` 徽章
  - `apps/agent/src/__tests__/RetryStrategy.test.ts` 5 + 2 = 7 个测试覆盖
- [x] **永久错误立即报**:auth fail (status=401) 不重试、StatusBadge `data-status="failed"` 渲染 `category=B · code=401`
  - `apps/agent/src/__tests__/AISession.test.ts › does not retry auth failures and moves to errored`
- [x] **进程错误重试 1 次**:`GENERAL_DELAYS` 默认 3 次,C 走 `PROCESS_DELAYS = [1000]`（仅 1 次）
- [x] **FIFO 并发上限**:ProviderSemaphore `limit=5`,第 6 个 query 等待
  - `apps/agent/src/__tests__/ProviderSemaphore.test.ts` 3 个测试
- [x] **取消清理**:`AbortController.abort()` → 进程清理,`meta.yaml.last_cancel_at` 写入
  - `apps/agent/src/__tests__/AISession.test.ts › aborts a queued turn`
- [x] **per-session log.jsonl + 全局 agent.log**:`sessionLogger?.logQuery` 在每次 send() 结束调用,`globalLogger?.retryExhausted/queryFailed` 在分类失败时调用
- [x] **POST /sessions/:sid/retry**:
  - 200 — 读 `meta.last_input` 调 `runTurn({ inputText, isRetry: true })`,ret 返回 `retryToken + runId`
  - 404 — session 不存在
  - 409 — `meta.last_input` 缺失(从未成功 send)
  - `apps/agent/src/__tests__/sessionsRetryRoute.test.ts` 4 + 1 e2e = 5 个测试
- [x] **isRetry 首退避跳过**:retry 路径 `initialDelayMs=0`,首 retry 不等 1s
  - `apps/agent/src/__tests__/RetryStrategy.test.ts › uses initialDelayMs=0`
  - `apps/agent/src/__tests__/AISession.test.ts › passes initialDelayMs=0 to retrySleep when isRetry=true`
- [x] **query_succeeded SSE 终态**:成功完成后 Agent 经 SseHub publish,Web 端 reducer 重置 status 为 idle
  - `packages/shared/src/sse.ts` 新增 variant
  - `apps/web/src/lib/__tests__/useExecutingSse.test.ts › drops stale runId events` 验证 reducer 重置 + 拒绝 stale
- [x] **EXECUTING 顶层接线**:
  - `useExecutingSse` 订阅 `/api/agent/events?reqId=...`,sessionId=null 时保 idle
  - `ToastHost` 渲染 retrying warn / retry-failed err 通知
  - StageStrip 4 状态(testid `executing-stage-status`,`data-status` 反映 current status)
  - Toolbar `executing-toolbar-retry` 仅 status=`failed` 时出现
  - AIEventColumn `executing-ai-event-cancelled-marker` 在 status=`cancelled` 时出现

## 依赖

- [01-p0-skeleton.md](01-p0-skeleton.md)
- [02-p1-write-queue.md](02-p1-write-queue.md)
- [04-p3-persistence.md](04-p3-persistence.md)

## 估时

0.5 周（+0.5 周 P5 UI 暴露）
