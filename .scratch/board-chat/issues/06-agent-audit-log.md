# 06 — Agent audit log 独立服务

**What to build:** `apps/agent/src/lib/audit-log.ts` 独立 audit log 服务, 落 `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`。ADR-0029 D16。

**Blocked by:** 03 — ChatSessionService

**Status:** ready-for-agent

- [ ] `AuditLogWriter` 类构造接收 `workspaceRoot`
- [ ] `writeAuditEntry(reqId, cardId, entry)` — 追加一行 JSONL 到 `audit/<reqId>/<cardId>/chat.log`
- [ ] 8 项字段 schema — `ts / toolName / toolUseId / args / result / decision / decidedBy / durationMs`
- [ ] Atomic write — `writeFileAtomic` tmp + rename 模式
- [ ] 30 天 sweep — 跟 SDK session 同步, 注册 hook 或 timer
- [ ] `mkdirSync` 父目录不存在时自动递归创建
- [ ] 决定者维度 — `user` / `auto-allow-toggle` / `bypassPermissions` / `timeout` / `deny-pattern`
- [ ] 跟 session.json 物理隔离 — 独立文件, 独立 path
- [ ] 单测: 写入 + 字段 + atomic + 30 天 sweep
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
