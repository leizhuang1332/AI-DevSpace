# 10 — 首次消息单次 AI 调用修复(`/start` 不消耗用户输入)

**What to build:** 修 board chat 首条消息被 SDK **处理两次**的 bug —— `POST /chat/sessions/start` 路由当前把用户首条消息的 content 当成 `Provider.runChatQuery({prompt})` 跑一次 AI turn(响应丢弃,只留 sessionId),然后 client `useEffect` 又通过 `POST /chat/sessions/:sessionId/query` 用相同 content resume 跑第二次 AI turn。本 ticket 让 `/start` 只 bootstrap sessionId,不消耗 prompt,用户首条消息由 `/query` 唯一处理。

**Blocked by:** None — 可立即开工

**Status:** ready-for-agent

## 根因速记(避免重蹈覆辙)

`apps/agent/src/routes/board-chat.ts:371` 的 `/start` handler:
```ts
const result = await chatProvider.runChatQuery({
  prompt: promptFromContent(parsed.data.content),  // ← 烧用户的 prompt
  cwd,
  additionalDirectories: [joinReqDir(reqId)],
  model: observedModel,
  permissionMode: DEFAULT_PERMISSION_MODE,
  userConfirmHandler: async () => ({ behavior: 'allow' as const }),
  onEvent: (event) => {
    if (event.kind === 'session_init') {
      observedSessionId = event.sessionId
      // ...其它事件(包含 message_assistant / tool_call / complete)丢弃
    }
  },
})
```

`onEvent` 只捕 `session_init`,**AI 的真实响应被静默丢弃**。client 端 `CardTranscriptPanel` 在 meta 加载后通过 `useEffect → stream.send` 把同一 content 发到 `/query`,resume session 又跑一次 AI turn。

→ 用户视角:
- 首条消息延迟 ×2(`/start` 黑盒跑完整 turn + `/query` 再跑一次)
- credits 双倍烧
- `/start` 期间 AI 若调 Write/Bash,`userConfirmHandler` 写死 `{behavior:'allow'}`,**用户无从 deny**(静默执行危险命令)
- SDK session 历史出现两次相同 user turn → 后续 AI 上下文污染
- e2e 用 `FakeChatProvider` 不暴露(fast + deterministic),prod 才显形

## Acceptance criteria

- [ ] `apps/agent/src/routes/board-chat.ts:371` `/start` 把 `prompt: promptFromContent(parsed.data.content)` 改为 `prompt: ''`
- [ ] `/start` 不再把 `parsed.data.content` 喂给 AI;响应丢弃逻辑保留(仍只捕 `session_init`,其它 `message_assistant` / `tool_call` / `complete` 静默丢)
- [ ] `parsed.data.content` 仍校验(保留 body schema 校验作为防御层),但不传给 SDK
- [ ] `apps/agent/src/__tests__/board/board-chat-route.test.ts` 第 331 行断言 `Provider 被调(且 prompt 含用户输入)` 改为断言 `runChatQuery 收到的 prompt === ''`
- [ ] `/query` 路由行为**不变**(仍 resume + SSE 推流),相关测试不破
- [ ] 端到端手测:在 dev 模式(user 真模型)进 board-chat 输 "hello" + send → 只看到**一次** assistant 响应(对应单 turn),无 silent 首 turn
- [ ] 端到端手测:prod 模式 `/start` 期间 AI 不再触发 tool call(空 prompt 下 SDK 不会发起工具调用)
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
- [ ] `pnpm --filter @ai-devspace/web test` GREEN
- [ ] 同步更新 `.scratch/board-chat/issues/` 09 个老 issue 的 checklist(如本 ticket 修了某个老 issue 的某项)

## 落地后预期流(对比修复前)

```
修复前: send → /start(AI turn 1,响应丢) → /query(AI turn 2,响应可见)   ×2
修复后: send → /start(空 prompt,仅 bootstrap) → /query(AI turn 1,响应可见)  ×1
```

## 不在范围内

- `/start` schema 解耦(`/start` 跟 `/query` 改用不同 schema)→ 留给 ticket 12
- `/start` 单 tab lock → 留给 ticket 11
- 决策 32 打字机 20ms / 决策 49 全局思考条 → 已 wontfix,不动

## Why

根因是 `/start` 把"bootstrap sessionId"和"处理首条消息"两个职责混在一起。bootstrap 只需让 SDK 创 session 并 emit `system/init`,不需要跑真实 turn。空 prompt 让 SDK 0.3.206 走"创 session + 立即 result(success)"路径,不消耗 tokens。

## How to apply

任何未来涉及 `/start` 路由的修改都必须保持"prompt === ''" 不变量;若新需求要 `/start` 也处理 content,改 ticket 流程讨论后再动,不要直接改回。