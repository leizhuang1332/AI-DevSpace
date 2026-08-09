# 01 — Shared board-chat schema (shared 端)

**What to build:** `packages/shared/src/board-chat.ts` 定义 board chat session / SSE event / audit log / MCP tool 协议 zod schema, 实现 ADR-0029 D4 + D10 + D16 形态。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] `ChatSessionMetaSchema` — 17 项 session.json 字段 (sessionId / requirementId / cardId / cwd / additionalDirectories / model / permissionMode / permissionPromptToolName / mcpServers / createdAt / lastQueryAt / queryCount / ownerUserId + 4 项 cost)
- [ ] `ChatSessionEventSchema` — 9 类 SSE event + 4 类 sub-agent event, 用 zod discriminatedUnion
- [ ] `ChatToolAuditSchema` — 8 项 audit 字段 (ts / toolName / toolUseId / args / result / decision / decidedBy / durationMs)
- [ ] `ChatDecisionSchema` — `'allow' | 'deny'` + reason 可选
- [ ] `ChatPermissionRequestSchema` / `ChatPermissionResolvedSchema` — MCP tool 协议
- [ ] `ChatMessageUserContentSchema` / `ChatMessageAssistantContentSchema` — content 块字段
- [ ] `ChatSessionSnapshotResponseSchema` — `GET /chat/sessions/.../snapshot` 响应
- [ ] `ChatSessionQueryRequestSchema` — `POST /chat/sessions/.../query` body
- [ ] `ChatSessionModelSwitchRequestSchema` — `PUT /chat/sessions/.../model` body
- [ ] `ChatSessionPermissionResolveRequestSchema` — `POST /chat/sessions/.../permission` body
- [ ] `ChatSessionCostCapResolveSchema` — `POST /chat/sessions/.../cost-cap` body
- [ ] `ChatSubAgentEventSchema` — task_started / task_progress / task_completed
- [ ] `ChatPlanModeToggleSchema` — `PUT /chat/sessions/.../plan-mode` body
- [ ] 暴露所有 types 给 agent + web 端共用
- [ ] 单测: 每个 schema 正反例 + discriminated union dispatch
- [ ] `pnpm --filter @ai-devspace/shared test` GREEN
