# 13 — `/query` session 失效自动恢复(端到端自愈)

**What to build:** 当 `POST /chat/sessions/<reqId>/<cardId>/chat/sessions/:sessionId/query` 调 SDK resume 一个**已失效**的 sessionId 时(典型场景:`/start` 时跑 FakeChatProvider 落 `sdk-fake-001` 假 id 进 session.json,后续切真 Provider 再 /query 真 SDK 找不到该 session),当前行为是 SSE 只输出 `chat_complete reason="error" sessionId="" totalTokens=0`,**web 端零自愈路径,用户必须手动删 session.json + 刷新才能恢复**。本 ticket 加端到端自动恢复:

1. `/query` 检测 SDK 报"session 失效"信号 → 自动删 stale session.json + 推 SSE `chat_error { code: 'SESSION_EXPIRED', recoverable: true }`
2. 新增 `POST /chat/sessions/<reqId>/<cardId>/reset` 端点 —— web 端在 SESSION_EXPIRED 事件后调用,服务端清 chat dir(sessions + audit + sdk jsonl),返 200
3. web 端 `useChatSessionReset` hook + CardTranscriptPanel 监听 SESSION_EXPIRED → 自动调 reset → 重新触发 /start
4. 防御性:删 session.json 前先 rename 到 `session.json.bak` 兜底(误删可恢复);**audit 与 SDK jsonl 一并删**(牺牲 ADR-0029 D16 物理独立性以换端到端自愈 UX)

**Blocked by:** 10 / 11 / 12(issue 10 已落 `prompt === ''`,不消耗 user input;issue 11 已锁并发 /start;issue 12 已 schema 解耦。本 ticket 是同一组 bug 的最后一个切片 —— `/start` 链路修完后,必须配套修"链路上某点失败后如何自愈")

**Status:** ready-for-agent

## 根因速记(避免重蹈覆辙)

`apps/agent/src/routes/board-chat.ts:584-605` 的 `/query` handler 无脑用 URL `sessionId` 作 `resumeSessionId` 调 SDK,**没有任何"该 session 是否真存在于 SDK store"的预处理校验**:

```ts
await runChatQuery({
  prompt: promptFromContent(parsed.data.content),
  ...
  resumeSessionId: sessionId,  // ← URL 路径参数,可能是 stale
  ...
})
```

`apps/agent/src/providers/ClaudeCodeProvider.ts:1076-1200` 真 SDK 找不到 session 时:
- 不 emit `system/init` → `observedSessionId` 保持初始空字符串(1076 行)
- emit `result` 但 `subtype ∉ {success, error_max_tokens, cancelled}` → 落到 `'error'` 分支(1163-1170 行)
- `chat_complete sessionId='' totalTokens=0 cost=0 reason='error'`

web 端 UI 看到 `chat_complete reason='error'` 没识别为可恢复,**只在面板显示无 AI 回复**,无任何"reset / 重新 /start"的提示/操作。

→ 用户视角:
- AI 一字不回,但 UI 表面"看起来完成了"(有 `chat_complete` 事件)
- 必须手动 `rm session.json` + F5 刷新,或重启 dev server
- dev 切 provider / 切换 worktree 都会触发该状态,高频踩坑

## Acceptance criteria

### agent route (`apps/agent/src/routes/board-chat.ts`)

- [ ] `/query` handler 追踪 SDK result 事件的 `reason === 'error' && sessionId === ''` 信号 → 记下 `sessionExpired: true`
- [ ] SSE 流收尾阶段(cleanup / end 之前)若 `sessionExpired === true` → 自动 `chatSessionService.delete(reqId, cardId)`(先 rename 到 `session.json.bak` 兜底)
- [ ] 在 `chat_complete` 之后立即推 SSE `chat_error { code: 'SESSION_EXPIRED', recoverable: true, message: 'SDK session 失效,前端将自动 reset' }`
- [ ] 新增 `POST /api/requirement/:id/board/cards/:cardId/chat/sessions/reset` 端点 —— 删 session.json + audit log + SDK jsonl,返 200 `{ acknowledged: true }`
- [ ] reset 端点复用 issue 11 单 tab lock(queryLocks 模式),防并发 reset 把 in-flight query 也清掉
- [ ] reset 端点不删 card 物理 dir,只清 chat 子目录内容(board/tasks/<ulid>/chat/ 下文件)

### agent service (`apps/agent/src/services/board/ChatSessionService.ts`)

- [ ] 新增 `delete(reqId, cardId)` 方法 —— 原子删 session.json(先 rename .bak 兜底) + audit/ 子目录(全删) + SDK jsonl(`~/.claude/projects/<hash>/<sid>.jsonl`,从 cwd 派生 hash)
- [ ] delete 参与 queryLocks 同款锁模式(同 lockKey 已有 in-flight 拒 409 session-locked)
- [ ] delete 不删 card 物理 dir 本身(card.json 等其他文件保留)

### shared (`packages/shared/src/board-chat.ts`)

- [ ] `chat_error` schema 加 `code: enum['E_QUERY_FAILED', 'E_SESSION_EXPIRED', ...]`(从 free string 收紧到 enum;E_QUERY_FAILED 已是路由层 catch 的 fallback,E_SESSION_EXPIRED 新增)
- [ ] 加 `CHAT_ERROR_CODE = { SESSION_EXPIRED: 'E_SESSION_EXPIRED', QUERY_FAILED: 'E_QUERY_FAILED' } as const`
- [ ] schema 文件顶部注释更新(新增 E_SESSION_EXPIRED 含义 + 触发场景)

### web hook (`apps/web/src/lib/board-chat-hooks.ts`)

- [ ] 新增 `useChatSessionReset(reqId, cardId)` mutation hook —— 调 POST reset,成功后 `qc.removeQueries(['board-chat-snapshot', reqId, cardId])` + `qc.invalidateQueries(...)` 强制 snapshot 重读(此时 meta 变 null)
- [ ] `useChatSessionStream` 在收到 `chat_error { code: 'E_SESSION_EXPIRED' }` 事件时 → 自动触发 reset hook(经由 callback ref,避免 hook 死循环)
- [ ] reset 完成后 `setStatus('closed')` + 不算 stream error

### web panel (`apps/web/src/components/board/detail/CardTranscriptPanel.tsx`)

- [ ] `handleSend` 在检测到 `stream.events` 末条为 `E_SESSION_EXPIRED` 时,自动 `await resetMutation.mutateAsync()` 然后**不**调 stream.send(让 user 重新输入 + send 触发新的 /start)
- [ ] 整个自愈链路必须在 1 次 user send 后自动完成,无需用户介入(manual reload / 删文件)

### 测试

- [ ] `board-chat-route.test.ts`:`/query` 用 stale sessionId 调用 → SDK mock emit `complete { reason: 'error', sessionId: '' }` → 断言 SSE 末条是 `chat_error { code: 'E_SESSION_EXPIRED' }` + session.json 被删(或被 rename 到 .bak)
- [ ] `board-chat-route.test.ts`:新增 `POST /reset` 端点测试 —— 删 session.json + audit/ + SDK jsonl,返 200
- [ ] `board-chat-route.test.ts`:并发 reset + in-flight query → reset 应被 409 session-locked 拒绝
- [ ] `board-chat-panel.test.tsx`:mock stream 推 `chat_error { code: 'E_SESSION_EXPIRED' }` → 断言 resetMutation.mutateAsync 被自动调 1 次
- [ ] `board-chat.test.ts`(shared):`chat_error` schema 加 `code: enum` 后,旧 free-string code 仍兼容 / 新 enum code 收紧

### 类型 / 文档

- [ ] `apps/agent/src/providers/AIProvider.ts` `ChatQueryResult` 加 `isSessionExpired: boolean`(由 Provider 层判定;ClaudeCodeProvider 看 `observedSessionId === '' && result.ok === true`);FakeChatProvider 永 false
- [ ] `.scratch/board-chat/issues/` 9 个老 issue 的 checklist(issue 13 修了"session 失效"老 issue 09 e2e spec 的某个观察点 —— issue 09 的 step 9 涉及"session 失效 → 自动 /start",本 ticket 落地此观察)

## 落地后预期流(对比修复前)

```
修复前:
  /start(FakeChatProvider,sessionId='sdk-fake-001' 落盘)
  → /query(resume='sdk-fake-001',真 SDK 找不到)
  → SSE chat_complete reason=error sessionId='' totalTokens=0
  → 用户看到无 AI 回复,必须手动删 session.json + F5

修复后:
  /start(FakeChatProvider,sessionId='sdk-fake-001' 落盘)
  → /query(resume='sdk-fake-001',真 SDK 找不到)
  → /query 检测 isSessionExpired=true
  → 自动 rename session.json → session.json.bak
  → 推 SSE chat_error { code: 'E_SESSION_EXPIRED', recoverable: true }
  → web 端 useChatSessionStream 收到 → 触发 useChatSessionReset.mutateAsync()
  → reset 端点删 audit/ + SDK jsonl(本 ticket 范围,细化为可拆 ticket)
  → react-query cache 清空 → snapshot.meta 变 null
  → CardTranscriptPanel 检测 stream.events 末条为 SESSION_EXPIRED
    → handleSend 已 await reset,不重复 send
  → 用户重新输入 → 触发新的 /start(FakeChatProvider 关掉 → 真 Provider)
    → 真 sessionId 落盘 → meta 出现 → useEffect 触发 stream.send(content)
  → AI 正常回复 ✓
```

## 不在范围内

- `/start` 检测 stale session 主动调 reset —— 跟 ticket 13 范围正交,留给后续。当前 /start 命中已存在 session.json 直接返现有 meta,不调 SDK;若 session.json 内的 sessionId 失效,下次 /query 走 ticket 13 自愈路径
- 客户端 BroadcastChannel 多 tab 协调 —— 已独立实现,不动
- 切 provider 后保留旧 session.json(用户视角"为什么我的 chat 不见了")—— 该问题应通过 ticket 13 自愈解决,不引入新端点

## Why

`/start` 链路修完后(issue 10/11/12),整条链路**首次启动**已经可靠。但 `/query` 调到 stale sessionId 时仍会**悄无声息失败**(无 UI 反馈 + 无自动恢复)。这是同一组 bug 链路上的最后一个切片 —— 必须修,否则 issue 09 e2e 的 "session 失效 → 自动 /start" 观察点(已写进 11 步 spec 但未落地)无法兑现。

## How to apply

未来 board chat 任何**写 SSE 流**的 endpoint 都必须:
1. 追踪 SDK 终态事件(reason / sessionId)判 `isSessionExpired`,不要相信单一事件;
2. 终态 `isSessionExpired=true` → 自动清理 session.json + 推 SSE `chat_error E_SESSION_EXPIRED`;
3. web 端 hooks 层统一响应 SESSION_EXPIRED → reset hook,UI 层不感知。

不要做"用户点确认 → 才 reset"的两步交互 —— session 失效是无声的、可恢复的、必须自动。