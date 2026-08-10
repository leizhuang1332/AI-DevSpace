# 11 — `/start` 接入单 tab lock(并发安全)

**What to build:** `POST /chat/sessions/start` 路由加入单 tab lock 守门,同一 `(reqId, cardId)` 并发两次 `/start` → 第二条返 `409 session-locked`,避免 session.json 撕裂写 / 双 sessionId 落盘 / sessionInit meta 跟 query 错位。

**Blocked by:** 10 — 必先 ticket 10 修完(`/start` 不再烧 prompt),lock 才有意义(否则 lock 住的是浪费 credits 的空 turn)

**Status:** ready-for-agent

## 根因速记

`/query` 路由有 `queryLocks: Map<string, QueryLockValue>` 守同 key 并发 query([board-chat.ts:281](apps/agent/src/routes/board-chat.ts)),但 `/start` 不参与这个 map。两条并发 `/start`(用户 + 助手同时点 send / 自动化脚本并发触发 / 浏览器慢网络下用户连点)会:
- 同时调 `Provider.runChatQuery` 拿 sessionId → 拿到**两个**不同 sessionId
- 同时调 `ChatSessionService.getOrCreateSession` 落 session.json → 第二个 tmp+rename 覆盖第一个,但 `lastQueryAt` 错位
- client 端 `useEffect` 拿哪个 meta 听天由命 → 后续 `/query` 用错的 sessionId resume → SDK 找不到对应 session

## Acceptance criteria

- [ ] `/start` 路由复用 `/query` 的 `queryLocks: Map<lockKey, QueryLockValue>` 模式(同 module-level state,key = `${reqId}::${cardId}`)
- [ ] `/start` handler 入口检查 `queryLocks.has(lockKey)` → 若有返 409 `session-locked`(reason 复用 `REASON_TO_HTTP_STATUS_BOARD_CHAT['session-locked']`)
- [ ] `/start` 落盘前 `queryLocks.set(lockKey, {promise, permissionRequestIds: new Set()})`,`finally` 里 `queryLocks.delete(lockKey)`
- [ ] `/start` 期间 SSE 不打开(本期不推 SSE),锁释放基于 route handler 完成即可,无需 `reply.raw.on('close')` cleanup
- [ ] 测试 `apps/agent/src/__tests__/board/board-chat-route.test.ts`:两个并行 `/start`(同 reqId/cardId) → 一个 200,一个 409 `E_SESSION_LOCKED`
- [ ] 测试:不同 `(reqId, cardId)` 的 `/start` 不互锁
- [ ] 测试:`/start` 抛错(SDK 失败 / session.json 写盘失败)→ 锁仍释放(`finally` 兜底)
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN

## 不在范围内

- 客户端 `useChatSessionLock` hook 改造 —— 已通过 BroadcastChannel 探测其他 tab 的 in-flight,但 lock 权威在服务端,本 ticket 仅锁服务端
- `/query` 锁策略改动 —— 不动
- ticket 12 schema 解耦 —— 独立 ticket,本 ticket 不依赖

## Why

`/start` 是写 session.json 的入口,并发等于双 sessionId;后续 `/query` resume 哪个都是错的。当前 `/query` 有 lock 但 `/start` 没有,是疏忽而非设计。

## How to apply

未来新增 board chat 任何写 session.json 的 endpoint(若引入)都必须复用 `queryLocks` map,不要新建独立 lock state;同 lock 语义(`${reqId}::${cardId}` key + Promise 占位 + finally 清理)否则会出现 lock 状态分裂。