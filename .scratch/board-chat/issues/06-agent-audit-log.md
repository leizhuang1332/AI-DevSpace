# 06 — Agent audit log 独立服务

**What to build:** `apps/agent/src/lib/audit-log.ts` 独立 audit log 服务, 落 `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`。ADR-0029 D16。

**Blocked by:** 03 — ChatSessionService

**Status:** ready-for-agent

- [x] `AuditLogWriter` 类构造接收 `workspaceRoot`
- [x] `writeAuditEntry(reqId, cardId, entry)` — 追加一行 JSONL 到 `audit/<reqId>/<cardId>/chat.log`
- [x] 8 项字段 schema — `ts / toolName / toolUseId / args / result / decision / decidedBy / durationMs`
- [x] Atomic write — `writeFileAtomic` tmp + rename 模式
- [ ] 30 天 sweep — 跟 SDK session 同步, 注册 hook 或 timer
  - **本期交付**:`sweepExpiredAuditLogs(workspaceRoot, reqId, opts)` + `sweepExpiredAuditLogsAll(workspaceRoot, opts)` 两个函数齐备,**已 GREEN** 单测
  - **defer → 后续 server bootstrap 接入**: 跟 SDK session sweep 同步定时器调用 `sweepExpiredAuditLogsAll`(本期 server.ts 还未注册周期 sweep,后续 chat session 接入 server bootstrap 时一起加)
- [x] `mkdirSync` 父目录不存在时自动递归创建
- [x] 决定者维度 — `user` / `auto-allow-toggle` / `bypassPermissions` / `timeout` / `deny-pattern`
- [x] 跟 session.json 物理隔离 — 独立文件, 独立 path
- [x] 单测: 写入 + 字段 + atomic + 30 天 sweep
- [x] `pnpm --filter @ai-devspace/agent test` GREEN
