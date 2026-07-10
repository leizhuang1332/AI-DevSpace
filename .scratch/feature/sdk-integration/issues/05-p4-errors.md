---
Status: needs-triage
Type: task
Stage: P4
---

# 05 - P4 错误处理：ErrorClassifier + RetryStrategy + CircuitBreaker

## 目标

落地 ADR-0010 Q8（错误处理）：5 类错误分类、退避重试、AbortController 取消、per-Agent in-flight 限流、双层日志。

## 范围

- [ ] `error/ErrorClassifier.ts` — 5 类分类
  - A SDK API 瞬时（rate limit / 5xx / timeout）→ 重试
  - B SDK API 永久（auth fail / quota exhausted）→ 立即报
  - C 进程错误（spawn fail / CLI exit ≠ 0）→ 重试 1 次
  - D 网络/IO（连接断 / socket timeout）→ 重试
  - E 业务错误（`error_max_turns` / agent 主动放弃）→ 不重试
- [ ] `error/RetryStrategy.ts` — 退避重试
  - 指数退避：1s / 3s / 10s
  - 最大 3 次
  - A/C/D 重试，B/E 不重试
  - 每次重试状态推 SSE（`retrying` 事件 + 当前次数 / 总次数）
- [ ] `error/CircuitBreaker.ts` — per-Agent 全局 in-flight 上限
  - 上限 5 个并发 query
  - 超过 → FIFO 等待队列
  - 与 Q4 写队列**职责正交**（Q4 是 per-req 写操作，CircuitBreaker 是 per-Agent 全局）
- [ ] AbortController 取消（Q8.2）：
  - 用户点「停止」→ Agent 调 `AbortController.abort()`
  - SDK 优雅清理子进程
  - 已收到的部分写 messages.jsonl 标 `incomplete: true`
  - meta.yaml 加 `last_cancel_at`
- [ ] 错误 UI 暴露（Q8.4）：
  - 重试中 → Toast「⚠️ 连接异常，重试中 (1/3)」
  - 重试失败 / B 永久错误 → StatusBar 红 + Chat 顶部条「❌ 本次响应失败」+「重试」按钮
  - E 业务错误 → 自然出现在 chat 流
  - 用户取消 → Chat「已停止」标记
- [ ] `log/SessionLogger.ts` — per-session `log.jsonl`
  - 每次 query 记录：input / output / error / tokens / 耗时
- [ ] `log/GlobalLogger.ts` — `~/.aidevspace/logs/agent.log`
  - 跨 session 系统级错误
  - Agent 启动 / 关闭 / 配置变更

## 验收

- 模拟 rate limit（用 mock provider）→ Agent 自动重试 3 次（1s/3s/10s 间隔），每次 Toast 提示
- 模拟 auth fail（无效 API key）→ Agent 立即报，不重试，StatusBar 红
- 模拟 process 死（kill 子进程）→ Agent 重试 1 次，再失败报
- 同 Agent 6 个 query 同时跑 → 第 6 个进 FIFO 等待
- 用户点「停止」→ SDK 进程清理，已收到的部分在 messages.jsonl 标 `incomplete: true`
- per-session log.jsonl 记录所有 query 元信息，全局 agent.log 记录系统级事件

## 依赖

- [01-p0-skeleton.md](01-p0-skeleton.md)
- [02-p1-write-queue.md](02-p1-write-queue.md)
- [04-p3-persistence.md](04-p3-persistence.md)

## 估时

0.5 周
