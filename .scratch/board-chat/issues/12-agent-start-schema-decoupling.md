# 12 — `/start` schema 解耦(API contract 整洁)

**What to build:** `POST /chat/sessions/start` 不再共用 `ChatSessionQueryRequestSchema`(`/query` 的 schema),改为自己的 `ChatSessionStartRequestSchema` —— 不要求 `content` 字段。客户端 `useChatSessionStart` + `CardTranscriptPanel.handleSend` 同步去除给 `/start` 传 content 的逻辑。旧客户端发来的 `content` 字段服务端**静默忽略**,不破老调用。

**Blocked by:** 10 — 必先 ticket 10 把"prompt === ''" 不变量立起来,schema 解耦才有意义(否则 content 还会被误用)

**Status:** ready-for-agent

## 根因速记

`/start` 跟 `/query` 当前共用 `ChatSessionQueryRequestSchema`([board-chat.ts:58](apps/agent/src/routes/board-chat.ts)):
```ts
{
  content: z.array(ChatMessageUserContentSchema).min(1),  // ← /start 不该有这字段
  model: z.string().min(1).optional(),
}
```

`/start` 不该要求 content —— 它的职责是 bootstrap sessionId,不处理用户输入;ticket 10 修完后 `/start` 不再把 content 喂给 AI,但 schema 上还要求 client 必须传 content,既冗余又误导。

## Acceptance criteria

### shared (`packages/shared/src/board-chat.ts`)

- [ ] 新增 `ChatSessionStartRequestSchema`(`model?` 可选,**无 `content`**),导出 `ChatSessionStartRequest` 类型
- [ ] 旧 `ChatSessionQueryRequestSchema` 不动(继续给 `/query` 用)
- [ ] 在 schema 文件加注释:解释为何 `/start` / `/query` 分两个 schema(职责分离 + 防止 client 误传 content 给 `/start`)
- [ ] `pnpm --filter @ai-devspace/shared test` GREEN(新增 schema 正反例)

### agent route (`apps/agent/src/routes/board-chat.ts`)

- [ ] `/start` handler 改用 `ChatSessionStartRequestSchema.safeParse(req.body)`
- [ ] 删除 `promptFromContent(parsed.data.content)` 调用(配合 ticket 10 已用 `prompt: ''`)
- [ ] 错误响应 reason 字面保持 `'invalid-body'` 不变(`REASON_TO_HTTP_STATUS_BOARD_CHAT` 不动)

### web hook (`apps/web/src/lib/board-chat-hooks.ts`)

- [ ] `UseChatSessionStartArgs` 删除 `content` 字段
- [ ] `useChatSessionStart.mutationFn` body 改为 `JSON.stringify(args)`(只传 model)
- [ ] 默认 args 为 `{}`,允许 `startMutation.mutateAsync()` 不传参

### web panel (`apps/web/src/components/board/detail/CardTranscriptPanel.tsx`)

- [ ] `handleSend` 在 `!meta` 分支调 `startMutation.mutateAsync({})`(不再传 `{ content }`)
- [ ] `useEffect` 监听 `meta` 变化触发 `stream.send` 的逻辑不变(用户 content 仍走这条路径到 `/query`)

### 测试

- [ ] `board-chat-route.test.ts` 新增:`/start` body 仅 `{}` 通过 schema 校验;body 含 `content` 字段时**校验通过**(back-compat 静默忽略),且 `runChatQuery` 收到的 prompt 仍 `=== ''`
- [ ] `apps/web/src/__tests__/board/board-chat-panel.test.tsx` 验证:`startMutation` 调用参数不含 `content`
- [ ] `pnpm --filter @ai-devspace/shared test` GREEN
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
- [ ] `pnpm --filter @ai-devspace/web test` GREEN

## 不在范围内

- 客户端 BroadcastChannel / 单 tab lock 客户端侧改动 —— 已独立实现,不动
- ticket 11 `/start` 单 tab lock —— 独立 ticket,本 ticket 不依赖

## Why

`/start` 跟 `/query` 是两个语义不同的端点(bootstrap vs 续 query),共用 schema 暴露了"它们语义一致"的错误信号。修后 schema 各自收敛,未来给 `/start` 加字段(如 `bootstrapMode: 'fresh' | 'resume-only'`)无需担心影响 `/query`。

## How to apply

未来新增 board chat 端点必须各自有专属 schema,不与其它端点共用;back-compat 策略统一为"加新字段为 optional + 旧字段保留为 optional 但服务端忽略",不要做 breaking schema 改动(老客户端可能仍在跑)。