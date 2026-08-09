# 03 — Agent ChatSessionService + 双轨持久化

**What to build:** `apps/agent/src/services/board/ChatSessionService.ts` 负责 board chat session 生命周期管理, 实现 ADR-0029 D4 + D5 + D8 + D9 + D16 形态。

**Blocked by:** 01 — Shared board-chat schema

**Status:** ready-for-agent

- [ ] `ChatSessionService` 类构造接收 `workspaceRoot`, 状态在进程内
- [ ] `getOrCreateSession(reqId, cardId, ownerUserId)` — 读 `board/tasks/<ulid>/chat/session.json`, 不存在则 SDK 首次 query 拿 sessionId 落盘
- [ ] Session 字段读 + 写 — `cwd` / `additionalDirectories` / `model` / `permissionMode` / `mcpServers` / `permissionPromptToolName`
- [ ] Cost 累计 — 每次 `result` 消息带 `usage` 字段, 累加到 session.json + sub-agent 计费
- [ ] 30 天 SDK 健康检查 — `existsSync` session.jsonl 路径, 缺失走重建
- [ ] 严格单 tab lock — `Map<sessionKey, Promise<void>>` 锁, 同 `(reqId, cardId)` 第二个 query 等待 / 拒绝
- [ ] Snapshot → `messages` 数组从 `system/init` 之前的 SDK jsonl 解析
- [ ] 写顺序契约 — SDK 拿到 sessionId → 立即 atomic 写 session.json, 失败 fallback
- [ ] **守门保留**: 不调用 `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter` 路径
- [ ] **Provider 内部实现** — 命名空间分离, 命名 `chatQuery()` / `chatQueryStream()`
- [ ] 模型路由 — 走 `ccSwitch.getCurrent()`(Q3 决策 P2 路径已 share)
- [ ] 单测: 17 项字段 round-trip + 30 天 sweep health check + cost 累计
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
