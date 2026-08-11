# 14 — `/query` SDK CLI throw 路径的 session 失效自愈(issue 13 的盲点)

**Status:** ready-for-agent

## 根因(真实调用栈跟踪 — 2026-08-11)

issue 13 的自愈路径在真实环境下**不生效**。诊断过程:

1. 真实 POST `/query` 复现:
   ```
   event: chat_message_user
   data: {...}
   event: chat_complete
   data: {"kind":"chat_complete","ts":...,"sessionId":"","totalTokens":0,"cost":0,"reason":"error"}
   ```
   **没有** `chat_error E_SESSION_EXPIRED` 事件,session.json 没动。

2. 加 `[claude-sdk-event]` 诊断日志抓 SDK 真实 emit:
   ```
   [claude-sdk-event] {"type":"result","subtype":"error_during_execution","session_id":"e992f28f-..."}
   ```
   **只一个** event(`result`),没有 `system/init`,没有 `error`。

3. 加 `[route-no-session-expired]` 诊断日志看路由层拿到什么:
   ```
   [route-no-session-expired] {
     result: {
       ok: false,
       error: 'Claude Code returned an error result: Error: --resume requires a valid
              session ID or session title when used with --print. Usage: claude -p
              --resume <session-id|title>. Provided value "sdk-fake-001" is not a
              UUID and does not match any session title.'
     }
   }
   ```

**完整调用链**:

| 步骤 | 行为 |
|---|---|
| 1. SDK 调 `mod.query({prompt, options:{resume:'sdk-fake-001', ...}})` | SDK 内部启 CLI 子进程 `claude -p --resume sdk-fake-001 ...` |
| 2. CLI 找不到该 sessionId(因为是 FakeChatProvider 留的假 id,非 UUID) | CLI 退出码非 0,stderr 写 `Error: --resume requires a valid session ID...` |
| 3. SDK 解析 CLI 输出,emit 1 个 `result { subtype: 'error_during_execution', session_id: '<new uuid>' }` event | Provider 走到 1157 行 `result` 分支,emit `complete { sessionId: '', reason: 'error' }`(`observedSessionId` 未被设置,仍是 '') |
| 4. SDK 把 CLI stderr 包成 Error **throw 出来**(在 for-await 退出时) | Provider catch (1201-1205) → return `{ ok: false, error: '...' }` |
| 5. 路由层拿到 `result.ok=false` | issue 13 的 `if (result.ok && result.isSessionExpired)` **不满足**(ok=false),自愈路径完全跳过 |

issue 13 的盲点:`isSessionExpired` 标志只在 `ok=true` 分支填。SDK 实际行为是 **先 emit result event 再 throw**,导致 catch 分支走 `ok=false`,isSessionExpired 永远不会被路由层看到。

## 修复方案

**核心改动**:`ClaudeCodeProvider` 的 catch 分支也判 session-expired 信号(根据 `input.resumeSessionId` + error message 含 `--resume requires a valid session ID` 特征),在 `ok=false` 分支填 `isSessionExpired: true`,路由层把 `if (result.isSessionExpired)` 改为不依赖 `result.ok` 的检查。

```ts
// ClaudeCodeProvider.ts catch 分支
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  const isSessionExpired =
    !!input.resumeSessionId &&
    /--resume requires a valid session ID|is not a UUID|does not match any session/i.test(message)
  return {
    ok: false,
    error: message,
    isSessionExpired,
  }
}
```

```ts
// 路由层 /query handler
if (result?.isSessionExpired) {
  // 不管 ok=true 还是 ok=false,只要 Provider 判定 session 失效就自愈
  try { chatSessionService.delete(reqId, cardId) } catch { ... }
  sseWrite({ kind: 'chat_error', code: 'E_SESSION_EXPIRED', recoverable: true })
}
```

## Acceptance criteria

### provider (`apps/agent/src/providers/ClaudeCodeProvider.ts`)

- [ ] catch 分支检测 error message 含 `--resume requires a valid session ID` / `is not a UUID` / `does not match any session` 模式 + `input.resumeSessionId` 非空 → 返回 `{ ok: false, error, isSessionExpired: true }`
- [ ] catch 分支不匹配模式 → 返回 `{ ok: false, error, isSessionExpired: false }`(默认)
- [ ] ok=true 分支保留 issue 13 的 `isSessionExpired` 计算逻辑不变

### shared (`packages/shared/src/board-chat.ts` / `apps/agent/src/providers/AIProvider.ts`)

- [ ] `ChatQueryResult` ok=false 分支加 `isSessionExpired?: boolean`(可选,默认 false)

### route (`apps/agent/src/routes/board-chat.ts`)

- [ ] `/query` handler 自愈分支条件从 `if (result && result.ok && result.isSessionExpired)` 改为 `if (result?.isSessionExpired)`(不依赖 ok)
- [ ] 自愈动作(delete + 推 E_SESSION_EXPIRED)保持不变
- [ ] catch 分支(Provider 同步 throw,err 不是 session-expired)仍走 E_QUERY_FAILED 路径

### 测试

- [ ] `claude-code-provider.test.ts`(或新建):模拟 Provider catch 分支走 session-expired 模式 → 断言 `result.ok=false && result.isSessionExpired=true`
- [ ] `claude-code-provider.test.ts`:catch 走非 session-expired error → `result.isSessionExpired=false`
- [ ] `board-chat-route.test.ts`:`/query` 模拟 Provider 返 `{ok:false, isSessionExpired:true}` → 断言 SSE 收到 `chat_error E_SESSION_EXPIRED` + session.json 被 delete

## 落地后预期流(对比修复前)

```
修复前:
  POST /query resume=sdk-fake-001
  → SDK CLI 找不到 session,emit result{error_during_execution},then throw
  → Provider catch → {ok:false, error:'...'}
  → 路由层 result.ok=false → 跳过 issue 13 自愈
  → SSE 只推 chat_complete reason='error'
  → 用户:无 AI 回复,无自愈

修复后:
  POST /query resume=sdk-fake-001
  → SDK CLI throw 'requires a valid session ID...'
  → Provider catch → 检测模式 → {ok:false, isSessionExpired:true, error:'...'}
  → 路由层 result.isSessionExpired=true → 删 session.json + 推 E_SESSION_EXPIRED
  → web 端 useChatSessionStream 收到 → 触发 useChatSessionReset
  → reset 端点清 audit/ + SDK jsonl → invalidate snapshot
  → CardTranscriptPanel 检测 stream.sessionExpired=true → banner 提示
  → 用户重新输入 → 触发新一轮 /start(FakeChatProvider 关掉,真 sessionId 落盘)
  → AI 正常回复 ✓
```

## Why

issue 13 自愈路径在 dev 切 provider / 切 worktree / 跨域迁移 session.json 失配场景下高频踩坑,但只覆盖 `ok=true` 分支,SDK CLI 实际走 `ok=false` 分支(先 emit result 再 throw)。这条调用栈必须在 agent 服务内真实验证,而 issue 13 e2e 测试用的是 FakeChatProvider,绕过真 CLI throw 路径。

## How to apply

未来任何 Provider 的 chat-query 路径,凡是涉及 SDK resume,**必须在 catch 分支也判 session-expired 信号**。判定准则:
1. `input.resumeSessionId` 非空(resume 操作上下文)
2. error message 含 SDK/CLI 关于 session not found / invalid session id 的特征子串
3. Provider 抛 `isSessionExpired: true`,路由层据此走自愈

不要只判 ok=true 分支 —— SDK 经常把错误结果当 result event emit 后再 throw。
