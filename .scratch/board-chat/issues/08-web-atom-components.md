# 08 — Web 原子组件: UsageBar / PermissionPrompt / PlanModePrompt / CostCapModal / SubAgentBlock / ToolCallBubble

**What to build:** 6 个原子组件, 视觉对照 `docs/design/pages/board-chat-subagent.html`。实现 ADR-0029 D8 + D10 + D14 + ADR-0029 D5 UX。

**Blocked by:** 07 — CardTranscriptPanel 大改 (consumers)

**Status:** ready-for-agent

- [x] `<UsageBar>` — 顶部常驻, props: `model / tokens / cost / turns / duration / subAgent: {tokens, cost} / autoAllowToggle: bool / planModeToggle: bool / onAutoAllowChange / onPlanModeChange / onModelChange`。 Visual: pill 风格
- [x] `<PermissionPrompt>` — props: `toolName / args / requestId / title / description / onAllowOnce / onAllowSession / onDeny`。 Visual: 居中 modal, 列命令预览
- [x] `<PlanModePrompt>` — props: `planContent: string / onAccept / onReject / onModify`。 Visual: markdown render + 3 选项按钮
- [x] `<CostCapModal>` — props: `currentCostUsd / capUsd / onContinueOnce / onContinueSession / onPause / onNewSession`。 Visual: 4 选项
- [x] `<SubAgentBlock>` — props: `taskId / description / status: 'started' | 'running' | 'completed' | 'failed' / summary / toolCalls[] / nestedChildren`。 Visual: 4 状态视觉 + 嵌套缩进, 嵌入 `<details>`
- [x] `<ToolCallBubble>` — props: `toolName / toolUseId / args / result / isError / isPending / durationMs`。 Visual: args 标题 + result 折叠
- [x] 视觉对照: `docs/design/pages/board-chat-subagent.html` (方案 A 主形态)
- [x] RTL 组件测试: `board-chat-panel.test.tsx` 覆盖(Seam 3)
- [ ] 决策 32 20ms 打字机应用到 assistant message 渲染
  > 延后:用户 2026-08-10 确认跳过本期实现(MessageStream 保留 partial 直接渲染 + 注释)。后续接 SDK 流式 token 节流时再做。
- [ ] 决策 49 AI 思考条 4 指示器 — 跟父决策一致
  > 延后:用户 2026-08-10 确认跳过本期实现。全局 ThinkBar 已 wontfix(`.scratch/ai-devspace-mvp/issues/16-think-bar-global.md`),ADR-0029 D13 "跟全局并行" 语义落空 —— 后续若恢复全局思考条再对齐。
- [x] brand palette 沿用决策 22 + Round 2 (board-color-options)
- [x] 设计 tokens 沿用: spacing 4 倍, font 9 档, radius 4 档
- [x] `pnpm --filter @ai-devspace/web test` GREEN

## issue 08 gap 补齐记录(2026-08-10)

6 个原子组件已在 commit 393cb8b(issue 07)落地,本期补齐真实功能缺口
(保留 bundled props,不为 issue 简写重命名 —— shared schema 字段名权威):

- **UsageBar**:新增 auto-allow toggle(`bypassPermissions` ↔ `default`)+ pill 风格 model 显示(brand 圆点 / expensive warning 色)+ subAgentCost
- **PermissionPrompt**:接 SSE 事件 `forced` 字段(敏感模式 banner 不再硬编码 false)
- **SubAgentBlock**:状态枚举 `progress`→`running` + 4 状态视觉(started/running spin+brand/completed success/failed error)+ toolCalls 摘要列表 + nestedChildren 递归渲染
- **ToolCallBubble**:durationMs(由 MessageStream 从 result.ts - call.ts 派生)+ result 折叠(`<details>`)
- **agent 新路由**:`PUT /permission-mode`(default ↔ bypassPermissions,与 plan 互斥守门)+ `useChatPermissionMode` hook + TDD(4 路由测 RED→GREEN)
- **测试**:`board-chat-panel.test.tsx` 16→31 GREEN + 新 `sub-agent-block.test.tsx` 8 GREEN
