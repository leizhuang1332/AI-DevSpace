# 16 — `/start` server 端同步生成 sessionId(UUID) — 适配 SDK 0.3.206 不暴露 sessionId

**What to build:** 修 `POST /chat/sessions/start` 在 SDK 0.3.206 下永远 500 的 bug —— 旧实现 `observedSessionId = event.sessionId` 依赖 SDK emit `system/init` event,但 SDK 0.3.206 在 `query()` 的 user-facing stream **永远不 emit** `system/init`(`Query` interface 没有 sessionId 字段,`initializationResult()` 也不含)。新实现:**server 端同步 `randomUUID()` 生成 sessionId,落 session.json;SDK bootstrap query 仍调,但 fire-and-forget 不 await session_init**。

**Blocked by:** 10 / 11 / 12(/start 不消耗 prompt + 单 tab lock + schema 解耦)

**Status:** ready-for-human

## 根因速记

`apps/agent/src/routes/board-chat.ts` `/start` 旧 handler(line 416-447):

```ts
const result = await chatProvider.runChatQuery({
  prompt: '',
  cwd,
  ...,
  onEvent: (event) => {
    if (event.kind === 'session_init') {
      observedSessionId = event.sessionId
    }
  },
})

if (!result.ok || !observedSessionId) {
  return failWith(reply, 'internal', 'SDK did not yield session_id ...')
}
```

**SDK 0.3.206 真实行为**(2026-08-13 探底 sdk.mjs 1.4MB bundle 确证):

1. **stream 路径不 emit `system/init`** —— sdk.mjs 中 `subtype:"init"` 字面量出现 **0 次**。SDK 在 CLI subprocess stdout → inputStream 路径上**只 forward** `system/post_turn_summary` / `system/task_summary` / `system/mirror_error` / `active_goal` / `result` 给 `for await` 调用方。`system/init` 被吞掉,仅用作 SDK 内部状态标记(初始化 hooks / permissions / 设置 `Query` 内部 sessionId 属性)。

2. **`Query` interface 不暴露 sessionId** —— [sdk.d.ts:2230-2525](node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.206/.../sdk.d.ts#L2230-L2525) 全部 296 行是控制平面方法(`interrupt` / `setPermissionMode` / `setModel` / `applyFlagSettings` / `initializationResult` / `supportedCommands` / `mcpServerStatus` / `setMcpServers` / `streamInput` / `close` 等),**没有 `sessionId` / `session_id` 字段**。

3. **`initializationResult()` 不含 sessionId** —— [sdk.d.ts:3369-3388](.../sdk.d.ts#L3369-L3388) `SDKControlInitializeResponse` 字段是 `commands / agents / output_style / available_output_styles / models / account / fast_mode_state`,**没有 sessionId**。`reinitialize()` 同上。

4. **唯一带 sessionId 的类**是 `DirectConnectTransport`(sdk.mjs:734824),是**远程 managed session** 专用(带 serverUrl / wsUrl / authToken,调 `getSessionId()` 拿),**不是给本地 spawn CLI subprocess 路径用的**。本地 `Query` 实例类型上**不**保证有 sessionId 字段(可能改名 / 改行为 / 后续 SDK 版本去掉)。

**结果**:`observedSessionId` 永远 = `null`,旧 `/start` 必 500:

```
POST /api/requirement/req-003-.../board/cards/.../chat/sessions/start
  500 Internal Server Error
  body: { error: 'E_INTERNAL', reason: 'internal', message: 'SDK did not yield session_id during start; cannot persist session.json' }
```

## 修复方案(方案 B — server 端同步 UUID)

```ts
// /start 路由 (apps/agent/src/routes/board-chat.ts:399-465)
const cwd = cardChatDir(reqId, cardId)
const serverSessionId = randomUUID()  // ← server 端 UUID,不再等 SDK

// fire-and-forget SDK bootstrap —— prompt='' 不消耗 user content(issue 10 不变量)
const runChatQuery = chatProvider.runChatQuery.bind(chatProvider)
const sdkPromise = runChatQuery({
  prompt: '',
  cwd,
  additionalDirectories: [joinReqDir(reqId)],
  model: 'claude-sonnet-5',
  permissionMode: DEFAULT_PERMISSION_MODE,
  userConfirmHandler: async () => ({ behavior: 'allow' as const }),
  onEvent: () => { /* swallow —— SDK 0.3.206 不 emit session_init */ },
}).catch((err: unknown) => {
  // SDK bootstrap 失败(进程崩 / spawn 失败 / timeout)不阻断 /start
  req.log.warn({ err, reqId, cardId }, '...')
})

// 立即落 session.json(不等 SDK)
const meta = await chatSessionService.getOrCreateSession(reqId, cardId, {
  sdkSessionId: serverSessionId,  // ← seed 字段名是历史命名,语义已变为 server UUID
  cwd,
  ...
})
void sdkPromise
return reply.code(200).send({ meta })
```

### 关键设计决策

1. **sessionId 语义重定义**: `session.json` 的 `sessionId` 字段从"SDK 提供的 sessionId"变为"server 端 UUID,前端用作会话标识 + URL path"。**SDK 内部 sessionId 由 SDK 自行管理**(藏于 `Query` 实例 / CLI subprocess,不通过此字段表达)。

2. **SDK bootstrap 是 fire-and-forget**: 不 await session_init,`session.json` 立即落盘。SDK 内部 session 创建 + `~/.claude/projects/<hash>/<sid>.jsonl` 落盘由 SDK 进程自己管(后台跑,失败不阻断 /start)。

3. **SDK 失败容忍**: SDK bootstrap throw / 进程崩 / spawn 失败,只 log warn,**不阻断 /start**。原因:sessionId 由 server UUID 提供,前端可用;SDK 内部 session 状态由下次 /query 自愈(issue 13)兜底。

4. **/query 路径不变**: URL `sessionId` = 我们 UUID,作 `resumeSessionId` 传 SDK。SDK 找不到 UUID 对应 jsonl → session expired → issue 13 自愈(chat_error E_SESSION_EXPIRED → web reset → 自动重 /start)。**跨刷新恢复靠 transcript events + 我们的 session.json(不靠 SDK jsonl)**。这是 SDK 0.3.206 协议决定的边界,issue 13 自愈机制就是为这种场景设计。

5. **queryLocks 锁窗口变窄**: SDK bootstrap 是 fire-and-forget,锁保护的是 session.json 落盘的瞬时窗口(~1ms)。并发 /start 由 `getOrCreateSession` 内部 `this.locks` 串行化落盘兜底 —— 两个并发 /start 拿到**同一 server UUID**(issue 11 PRD 修订)。

## Acceptance criteria

### agent route (`apps/agent/src/routes/board-chat.ts`)

- [x] `/start` handler 同步生成 `randomUUID()` 作 `serverSessionId`(line 434)
- [x] `Provider.runChatQuery` 调但不 await(`sdkPromise` fire-and-forget,line 441-462)
- [x] SDK throw / 失败 → `.catch` log warn,不阻断 /start(line 453-462)
- [x] session.json 立即落盘,不等 SDK(line 469-477)
- [x] `void sdkPromise` 保留引用避免 GC(line 482)
- [x] 顶部 doc comment 更新(issue 16 决策说明,line 4-9)

### 测试 (`apps/agent/src/__tests__/board/board-chat-route.test.ts`)

- [x] issue 16 test 1: SDK 不 emit session_init → /start 200 + meta + server UUID
- [x] issue 16 test 2: session.json on disk uses server UUID, not SDK sessionId
- [x] issue 16 test 3: SDK query throw 不再阻断 /start —— fire-and-forget 容忍 SDK 失败
- [x] issue 16 test 4: 第二次 /start 命中已落盘 session,不再调 SDK
- [x] 旧测试 "200 + meta when no prior session" 改:sessionId 是 server UUID,不再是 'sdk-sess-first-001'
- [x] 旧测试 "200 + meta when body is empty" 改:sessionId 是 server UUID
- [x] 旧测试 "409 session-locked" → 改 "concurrent /start on same (reqId, cardId) → both 200 with SAME sessionId (no torn write)":反映新行为(锁窗口 ~1ms,getOrCreateSession 内部锁串行化)
- [x] 旧测试 "lock is released even when SDK fails" → 改 "SDK bootstrap throw does NOT block /start":反映新容忍语义

### 回归确认

- [x] `apps/agent` vitest: 1094/1094 GREEN
- [x] `apps/web` vitest: 1200/1200 GREEN
- [x] `packages/shared`: 347/348 (1 预先 fail `ChatToolAuditSchema accepts decidedBy=auto` — clean main 上也 fail,不在 issue 16 范围)
- [x] `packages/scripts`: 5/6 (1 预先 fail `agent-start.test.ts already running` — clean main 上也 fail,不在 issue 16 范围)

## 落地后预期流(对比修复前)

```
修复前 (SDK 0.3.206 真实行为):
  POST /chat/sessions/start
    → runChatQuery(prompt='') → SDK 不 emit session_init → observedSessionId=null
    → failWith('internal', 'SDK did not yield session_id')
    → 500
    → web 端:User 看到 "internal error",无法 /start
    → 整个 board chat 死锁(无 session.json → /query 拿不到 meta)

修复后:
  POST /chat/sessions/start
    → server 端 randomUUID() = serverSessionId
    → runChatQuery(prompt='')  fire-and-forget(SDK 内部创 session + 落 jsonl,不阻塞)
    → getOrCreateSession(serverSessionId) → 立即落 session.json
    → 200 { meta: { sessionId: serverSessionId, model, cwd, ... } }
    → web 端:useEffect 拿 meta,触发 stream.send(content) → /query
    → /query: resumeSessionId = serverSessionId,SDK 找不到 → issue 13 自愈
       → chat_error E_SESSION_EXPIRED → web 调 reset → 自动重 /start
       → 新 serverSessionId,新 session.json
       → /query 重新调 SDK 创新 session(不传 resume),AI 正常回复
```

## 不在范围内

- **降 SDK 版本** —— 回到 0.3.206 之前 emit `system/init` 的版本。代价:放弃 issue 15 依赖的 `assistant` event 透传 / interrupt_receipt_v1 capability 等。issue 16 接受 fire-and-forget + 自愈路径,优于降版。
- **追踪 SDK Query 实例 sessionId** —— SDK 0.3.206 类型不保证(Query interface 296 行无此字段),后续 SDK 版本可能改名 / 去掉。`as any` 强转 + 读私有属性的"方案 1"在类型层不可行,运行时层不稳定。
- **/start 检测 stale session 主动调 reset** —— 跟 issue 13 范围正交,留后续。
- **跨刷新恢复靠 SDK jsonl** —— issue 16 决定改靠 transcript events + 我们的 session.json(issue 09 e2e 11 步 spec 仍可走,只是语义上 transcript 是 source of truth,SDK jsonl 是副产物)。

## Why

`/start` 链路上**(1) issue 10 修 prompt=' ' 不消耗 user content,(2) issue 11 修单 tab lock,(3) issue 12 修 schema 解耦,**(4) issue 13 加 /query session 失效自愈** —— **但** `observedSessionId` 来自 SDK `session_init` event 这条**链路上的最关键环节**被 SDK 0.3.206 协议变更打破。这是同一组 bug 链路上**最后的 1 个切片**:不修,整条 `/start` 链路在 SDK 0.3.206 下完全死锁。

## How to apply

未来任何 board chat 涉及 sessionId 的代码修改必须:

1. **不再假设 SDK emit session_init** —— 0.3.206 不暴露。Server 端永远以 server UUID 为主,SDK 内部 sessionId 视为不透明。
2. **不再假设 SDK 内部 sessionId === session.json.sessionId** —— 两者解耦。SDK jsonl `~/.claude/projects/<hash>/<sid>.jsonl` 是副产物,不要用作"重置" / "resume" 路径的 source of truth。
3. **跨刷新恢复靠 transcript events + 我们的 session.json** —— 不要再依赖 SDK resume 协议作为 primary 路径(可作为 secondary 优化)。
4. **SDK bootstrap / fire-and-forget 失败 → log warn,不阻断** —— 任何依赖 SDK 内部状态的前置 /start 步骤必须容忍 SDK 失败,fallback 路径由 issue 13 自愈兜底。
5. **任何改 `ClaudeCodeProvider` 的 chat 路径 → 必须 RED → GREEN(ADR-0023 D11 守门契约)** —— 本 issue 没动 Provider,仅动 `/start` route handler;Provider 改时也按此契约。
