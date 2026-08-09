# 08 — Web 原子组件: UsageBar / PermissionPrompt / PlanModePrompt / CostCapModal / SubAgentBlock / ToolCallBubble

**What to build:** 6 个原子组件, 视觉对照 `docs/design/pages/board-chat-subagent.html`。实现 ADR-0029 D8 + D10 + D14 + ADR-0029 D5 UX。

**Blocked by:** 07 — CardTranscriptPanel 大改 (consumers)

**Status:** ready-for-agent

- [ ] `<UsageBar>` — 顶部常驻, props: `model / tokens / cost / turns / duration / subAgent: {tokens, cost} / autoAllowToggle: bool / planModeToggle: bool / onAutoAllowChange / onPlanModeChange / onModelChange`。 Visual: pill 风格
- [ ] `<PermissionPrompt>` — props: `toolName / args / requestId / title / description / onAllowOnce / onAllowSession / onDeny`。 Visual: 居中 modal, 列命令预览
- [ ] `<PlanModePrompt>` — props: `planContent: string / onAccept / onReject / onModify`。 Visual: markdown render + 3 选项按钮
- [ ] `<CostCapModal>` — props: `currentCostUsd / capUsd / onContinueOnce / onContinueSession / onPause / onNewSession`。 Visual: 4 选项
- [ ] `<SubAgentBlock>` — props: `taskId / description / status: 'started' | 'running' | 'completed' | 'failed' / summary / toolCalls[] / nestedChildren`。 Visual: 4 状态视觉 + 嵌套缩进, 嵌入 `<details>`
- [ ] `<ToolCallBubble>` — props: `toolName / toolUseId / args / result / isError / isPending / durationMs`。 Visual: args 标题 + result 折叠
- [ ] 视觉对照: `docs/design/pages/board-chat-subagent.html` (方案 A 主形态)
- [ ] RTL 组件测试: `board-chat-panel.test.tsx` 覆盖(Seam 3)
- [ ] 决策 32 20ms 打字机应用到 assistant message 渲染
- [ ] 决策 49 AI 思考条 4 指示器 — 跟父决策一致
- [ ] brand palette 沿用决策 22 + Round 2 (board-color-options)
- [ ] 设计 tokens 沿用: spacing 4 倍, font 9 档, radius 4 档
- [ ] `pnpm --filter @ai-devspace/web test` GREEN
