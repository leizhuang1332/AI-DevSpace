# 02 — ADR-0023 RED e2e 守门(changes 必先 RED, 后 GREEN)

**What to build:** 扩展 `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 加 chat 路径 RED 测试, 实现 ADR-0029 D11 守门契约。

**Blocked by:** 01 — Shared board-chat schema

**Status:** ready-for-agent

- [ ] 新增 describe block: `chat 路径 SDK 协议完整覆盖`
- [ ] RED 测试 1: chat query 启动 → 收到 `system/init` 消息 → `sessionId` 提取正确
- [ ] RED 测试 2: 第二次 query 带 `options.resume: sessionId` → SDK 加载历史
- [ ] RED 测试 3: `permissionPromptToolName: 'mcp__boardchat__user_confirm'` 触发 → MCP tool handler 收 SDK 入参(`toolName` / `input` / `requestId` / `displayName` / `title`)
- [ ] RED 测试 4: MCP tool handler 返 `{behavior: 'allow', updatedPermissions: [...]}` → SDK 继续执行
- [ ] RED 测试 5: MCP tool handler 返 `{behavior: 'deny', message: '...'}` → SDK 终止当前工具
- [ ] RED 测试 6: stream_event 透传 — 我们从 SDK 收到的 `stream_event` 透到 web
- [ ] RED 测试 7: `task_started` / `task_progress` / `task_completed` 事件格式
- [ ] RED 测试 8: `cwd` 冻结 — resume 时改 cwd 无效
- [ ] RED 测试 9: `additionalDirectories` 限制 — cwd 之外读未被白名单包 → SDK 拒绝
- [ ] RED 测试 10: `mcpCallCounter` 物理隔离 — chat 路径不增加 runAnalysisQuery 的 counter
- [ ] **必先 RED 后 GREEN** — 此次 commit 必新增 RED, 后续 Provider 实现走 GREEN
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
