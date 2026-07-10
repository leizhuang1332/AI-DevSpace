---
Status: needs-triage
Type: task
Stage: P0
---

# 01 - P0 骨架：Fastify + CcSwitchClient + AIProvider + AISession + 1 条 SSE

## 目标

落地 ADR-0010 Q1 (SDK 选型) + Q2 (AIProvider 抽象) + Q9 (CcSwitchClient 只读) + Q10.2 (1 条 SSE 通道起步)

跑通最小闭环：在 Agent 端能用 SDK 跑一句 prompt，把流式 chunk 推到 Web。

## 范围

- [ ] 装 `@anthropic-ai/claude-code` 到 `apps/agent/package.json`
- [ ] 装 `better-sqlite3` 到 `apps/agent/package.json`（读 cc-switch.db）
- [ ] `providers/AIProvider.ts` — 定义 `AIProvider` 接口 + `AISession` 接口 + `AIEvent` 联合类型（按 ADR-0010 Q2 完整字段）
- [ ] `providers/ClaudeCodeProvider.ts` — 实现 `createSession(reqId, opts): AISession`，内部包 `query()`
- [ ] `providers/CcSwitchClient.ts` — 启动时 read-only 打开 `~/.cc-switch/cc-switch.db`，构建 `ProviderIndex` Map；提供 `getCurrent()` / `getAll()` / `getById()` / `getModel(providerId, role)` 4 个查询方法
- [ ] `session/AISession.ts` — `AISession` 实现类，维护 `state: idle/busy/closed/errored`，把 SDK `AsyncIterable<SDKMessage>` 转换成 `AsyncIterable<AIEvent>`
- [ ] `sse/SseHub.ts` — 先实现 1 条全局 SSE 通道（per-session N 条留给 P5），能 `publish(event)` 推到所有订阅者
- [ ] Fastify 端暴露测试 endpoint：
  - `POST /api/spike/run` — body `{ prompt: string }`，调 SDK 跑一次，把所有 AIEvent 推 SSE
  - `GET /api/spike/events` — SSE 订阅
- [ ] 控制台日志能看清：cc-switch 当前 provider / role / model id、SDK 启动 / 流事件 / done

## 验收

- 启动 Agent 后，控制台打出「cc-switch 当前 provider: MiniMax, model.main: MiniMax-M3」
- `curl -N http://localhost:7777/api/spike/events` 建立 SSE 长连
- `curl -X POST http://localhost:7777/api/spike/run -d '{"prompt":"hi"}'` 触发 query
- SSE 收到 `thinking` / `text` / `done` 事件流
- 控制台日志显示 SDK 进程 spawn 一次、流完即退

## 依赖

- [Issue 03-agent-skeleton.md](../../ai-devspace-mvp/issues/03-agent-skeleton.md)（Fastify 骨架）
- Spike 笔记 `../spike-notes.md`（验证 SDK 行为后再开工）

## 估时

1 周
