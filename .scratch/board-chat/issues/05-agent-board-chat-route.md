# 05 — Agent board chat HTTP 路由 + SSE 推送

**What to build:** `apps/agent/src/routes/board-chat.ts` 提供 board chat HTTP 端点 + SSE 流。实现 ADR-0029 D9 + D10 协议。

**Blocked by:** 03 — ChatSessionService, 04 — MCP tool handler

**Status:** ready-for-agent

- [ ] `POST /api/requirement/:id/board/cards/:cardId/chat/sessions/start` — 首次启动 chat
- [ ] `POST /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/query` — 续 query(SSE 流)
- [ ] `GET /api/requirement/:id/board/cards/:cardId/chat/sessions/snapshot` — 拿 transcript 历史
- [ ] `PUT /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/model` — 切 model
- [ ] `PUT /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/plan-mode` — 切 plan mode
- [ ] `POST /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/permission` — 决议 permission
- [ ] `POST /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/cost-cap` — 决议 cost cap
- [ ] 错误响应: `requirement-not-found` / `card-not-found` / `session-not-found` / `invalid-body` / `tab-locked` / `internal`
- [ ] SSE 流通过 `@fastify/sse`(决策 31), 9 类事件 + 4 类 sub-agent 事件 shape
- [ ] Resume 协议 — `query({options: {resume: sessionId, ...}})` 流程
- [ ] Snapshot 协议 — 从 SDK jsonl 解析 messages 数组
- [ ] 严格单 tab — Mutex lock, 第二个 query 返 `tab-locked`
- [ ] 鉴权 — 沿用 `authPlugin` + cookie
- [ ] 单测: route 集成 + SSE 事件 shape + 错误响应
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
