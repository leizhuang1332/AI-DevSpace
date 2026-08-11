# 15 — `/query` assistant 消息事件处理(SDK 0.3.206 真实事件流)

**Status:** ready-for-agent

## 根因(2026-08-11 真实调用栈)

issue 14 修复后,真实 curl `/query` 仍看不到 AI 回复。诊断过程:

1. 真实 POST /query:
   ```
   event: chat_message_user
   event: chat_session_init  → sessionId=2ca6c7b1-...
   event: chat_complete      → sessionId=2ca6c7b1-...  totalTokens=26361  cost=$0.08  reason=end_turn
   ```
   **没有 `chat_message_assistant` 事件**。SDK 真实跑了 1 turn(26k tokens,end_turn),但 assistant 文本没出现在 SSE 流。

2. 加 `[sdk-event]` 诊断日志抓 SDK 真实事件:
   ```
   [sdk-event] type=system, subtype=init
   [sdk-event] type=system, subtype=thinking_tokens  × 7
   [sdk-event] type=assistant, msg_keys=[id,type,role,content,model,stop_reason,...]  × 2
   [sdk-event] type=result, subtype=success
   ```

3. 看 `apps/agent/src/providers/ClaudeCodeProvider.ts` `chatQuery` 函数 (1075-1222 行) for-await 循环的事件分发:
   - `type=system && subtype=init` → `session_init` event ✓
   - `type=stream_event` → `content_block_delta / task_*` 透传(只处理 `text_delta`)
   - `type=result` → `complete` event ✓
   - `type=error` → `error` event ✓
   - **`type=assistant` 完全没有 case 处理** —— 走完 4 个 if 后落到 `continue`(因为 for-await 顶层每个 case 用 continue/else 模式,但 `type=assistant` 不匹配任何分支,会落到最外层 for-await 末尾,但末尾无 default 分支,直接被 for-await 跳过)

   SDK 0.3.206 实际 emit `type=assistant` 携带完整 assistant 消息(m.content 是 `[{type:'text', text:'...'}, ...]` 数组);`type=stream_event` + `text_delta` 模式只在 `--include-partial-messages` 开启时才有;**生产 SDK 默认走 `type=assistant` 完整消息模式**。

   **结果**:SDK 已经把 assistant 文本吐给 Provider,但 Provider 当作"不认识的事件"丢弃 → SSE 流里 `chat_message_assistant` 事件从未发出 → web 端 `MessageStream` 看不到任何 assistant 气泡 → 用户"没有 AI 回复"。

## 修复方案

`ClaudeCodeProvider.chatQuery` 加 `type=assistant` 事件处理分支:

```ts
// assistant → 完整 assistant 消息
if (type === 'assistant') {
  const message = m['message'] as { content?: unknown } | undefined
  const content = message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>)['type'] === 'text') {
        const text = (block as Record<string, unknown>)['text']
        if (typeof text === 'string' && text.length > 0) {
          input.onEvent({
            kind: 'message_assistant',
            ts,
            text,
            partial: false,  // SDK 0.3.x assistant event 是完整消息
          })
        }
      }
    }
  }
  continue
}
```

同时(顺手):`type=system, subtype=thinking_tokens` 也透传为 `message_assistant { thinking }` 块 — 但**本期范围只修 text,thinking 留作后续**(issue 边界守住,避免单 ticket 膨胀)。

## Acceptance criteria

### provider (`apps/agent/src/providers/ClaudeCodeProvider.ts`)

- [ ] `chatQuery` for-await 循环加 `type=assistant` 分支:从 `m.message.content` 数组提 `type='text'` 块,emit `message_assistant { ts, text, partial: false }` event
- [ ] 单个 assistant event 可能含多个 text 块(罕见但 SDK 文档支持)→ 多个 emit 顺序追加;或者合并为 1 个 emit(本期选简单:合并为 1 个 emit,text = blocks.map(text).join(''))
- [ ] thinking_tokens 不在本期范围(避免 ticket 膨胀)
- [ ] message.content 不是数组 / block.type 不是 'text' / text 不是 string → 静默跳过该 block,不抛错

### 测试

- [ ] `ClaudeCodeProvider.runChatQuery.test.ts`:模拟 SDK 1 个 assistant event(content 数组含 1 个 text 块 'hello')→ 断言 onEvent 被调 1 次,event 是 `{kind:'message_assistant', text:'hello', partial:false}`
- [ ] 模拟 assistant event 含多个 text 块 → 合并为 1 个 emit(顺序拼接)
- [ ] 模拟 assistant event 的 content 不是数组 / block 非 text / text 非 string → 静默跳过
- [ ] 模拟完整 SDK 流程:system/init → assistant('hi') → result(success) → 断言 onEvent 收到 4 个 event (session_init, message_assistant, complete + Provider final return)

## 落地后预期流

```
修复前:
  POST /query content=hi
  → SDK emit: system/init, system/thinking_tokens ×N, assistant(content=[text='...']), result(success)
  → Provider for-await 循环只处理 system/init + result,assistant/thinking 落空 continue
  → SSE 只推 chat_session_init + chat_complete(26k tokens, end_turn)
  → web 端:无 assistant 气泡 → 用户"没 AI 回复"

修复后:
  POST /query content=hi
  → SDK emit 同样序列
  → Provider 收到 assistant event → emit message_assistant{text, partial:false}
  → SSE 推 chat_session_init + chat_message_assistant + chat_complete
  → web 端 MessageStream 看到 assistant 气泡 → 显示 AI 回复 ✓
```

## Why

issue 14 修了"session 失效"链路,但**完整对话链路还有 1 个静默丢事件的 bug** —— Provider 的 event dispatch 表不完整。SDK 0.3.206 默认走完整消息模式,`type=assistant` 是主载体。issue 09 e2e 用 FakeChatProvider 不调真 SDK,跳过这条路径;issue 13/14 聚焦 session lifecycle,也不修此链路。这是同一组"board chat 跑通"任务的最后 1 个切片。

## How to apply

未来任何 Provider for-await SDK event 的代码,**必须列出 SDK 文档说明的所有 `type`** 然后逐分支处理:

| SDK type | Provider 行为 |
|---|---|
| system + init | session_init |
| system + thinking_tokens | message_assistant{thinking} 或忽略(本期) |
| assistant | message_assistant{text, partial:false} |
| stream_event + content_block_delta + text_delta | message_assistant{text, partial:true}(只在 --include-partial-messages 时存在) |
| result | complete |
| error | error event |

不要假设"SDK 不发 X event 就不需要 case" —— 漏 case 等于静默丢事件,SSE 上看是"AI 没说话"。
