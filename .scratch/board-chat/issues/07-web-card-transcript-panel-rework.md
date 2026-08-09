# 07 — Web CardTranscriptPanel 大改 + UX 集成

**What to build:** 把 `apps/web/src/components/board/detail/CardTranscriptPanel.tsx` 从哑写入器升级为完整 chat UI, 集成 9 类 SSE 事件 + 串起所有新组件 (UsageBar / PermissionPrompt / PlanModePrompt / CostCapModal / SubAgentBlock / ToolCallBubble)。实现 ADR-0029 D8 + D9 + D10 + D14 + D15。

**Blocked by:** 01 — Shared schema (board-chat types from shared)

**Status:** ready-for-agent

- [ ] CardTranscriptPanel 顶层结构:
  - 顶部 `<UsageBar>` (model / tokens / cost / turns / duration + sub-agent sub-line)
  - 中间 `<MessageStream>` (user / assistant 气泡 + 嵌入 SubAgentBlock)
  - 底部 `<CardTranscriptInput>` (textarea + 发送按钮)
- [ ] 实时 SSE 订阅 — `useChatSession(reqId, cardId)` hook 接入 agent SSE
- [ ] 9 类 SSE 事件 dispatch — 渲染对应组件
- [ ] 旧 transcript.yaml 折叠块 — D12 banner + 折叠 group
- [ ] Toggle 状态保持沿用 ADR-0027 D5.3
- [ ] `<CardTranscriptInput>` 重构 — 仍 textarea + send, 但接入 mutation hook 触发 query
- [ ] Snapshot 渲染 — 初次进入先 GET snapshot, 渲染历史, 然后 SSE 续新事件
- [ ] 严格单 tab lock display — input box disabled + 顶部 "⚠️ 已在另一 tab 打开"
- [ ] 跨刷新恢复 — 实现 (Q6 d3) snapshot + resubscribe
- [ ] 打字机 20ms 渲染 — 决策 32 沿用
- [ ] 切 model 弹 `<CostCapModal>` 形态的 confirm modal
- [ ] 切 plan mode toggle — UsageBar 内 toggle, on/off
- [ ] React Query 集成 — `useChatSession` / `useChatQuery` / `useChatPermission` / `useChatModelSwitch`
- [ ] 移除旧的 `useSendTranscriptMessage` 调用 + 旧 PRD 引用加 banner
- [ ] 组件测试: `board-chat-panel.test.tsx` 覆盖主要交互(mock SSE)
- [ ] `pnpm --filter @ai-devspace/web test` GREEN
