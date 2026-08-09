# 09 — E2E: board-chat Playwright

**What to build:** `apps/web/e2e/board-chat.spec.ts` Playwright 完整流程测试, 实现 Seam 1 (E2E 最高) 覆盖。沿用 `apps/web/e2e/board.spec.ts` 模式。

**Blocked by:** 07 — CardTranscriptPanel, 08 — 原子组件, 06 — audit log

**Status:** ready-for-agent

- [ ] Playwright spec 完整跑通路径:
  - 打开 board 详情页 → 验证右栏默认属性态
  - 点 `[💬 在对话中打开]` → 看到 chat 框 + UsageBar
  - 输入消息 → 发 → 看到 AI 流式 text 出现(等 30s 等待首次 reply)
  - AI 触发 Write tool → 弹 `<PermissionPrompt>` modal
  - 点 [Allow once] → 看到 tool result + 后续 AI 继续
  - 切 model dropdown → 弹 confirm modal → 继续
  - 切 plan mode toggle → AI 给 plan → 弹 `<PlanModePrompt>` modal
  - 点 [Accept] → AI 切 default mode 执行 → 看到 tool call
  - 触发 cost cap mock $5 → 弹 `<CostCapModal>` 4 选项
  - 刷新页面 → 历史 transcript 完整恢复 → 续对话
  - 开 2 个 tab → 第二个 tab 弹 "已在另一 tab 打开"
- [ ] 走 demo workspace (`fixtures/`) demo Requirement + TaskCard 已有 transcript
- [ ] 走真 agent (7777) + 真 web (3333) + 真 SDK (mock 加速,避免真模型)
- [ ] 视觉对照: 截图保存到 `apps/web/e2e/__screenshots__/board-chat-*.png` 供 review
- [ ] **守门触发**: 任何 board chat UI 改动必跑此 e2e
- [ ] `pnpm --filter @ai-devspace/web e2e:board-chat` GREEN
- [ ] 接力 test fixture: `dev-server` + `mock-sdk` + `clean-state`
