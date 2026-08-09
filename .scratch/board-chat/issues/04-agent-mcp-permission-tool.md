# 04 — Agent mcp__boardchat__user_confirm MCP tool handler

**What to build:** 实现 SDK 0.3.206 `permissionPromptToolName` MCP tool handler, 拦截写工具, 推 SSE 给 web, 收用户决议, 返 `PermissionResult`。ADR-0029 D5。

**Blocked by:** 02 — ADR-0023 RED e2e, 03 — ChatSessionService

**Status:** ready-for-agent

- [ ] `mcp__boardchat__user_confirm` MCP tool — `createSdkMcpServer({name: 'boardchat', tools: [tool('user_confirm', ..., z.object({...}), async args => {...})]})`
- [ ] Tool 入参 schema — `toolName / input / requestId / displayName / title / description / suggestions`
- [ ] Handler 推到 SSE — `chat_permission_request` 事件, 阻塞等 `chat_permission_resolved`
- [ ] 决议路由 — `Allow once` → `{behavior: 'allow'}`, `Allow session` → `{behavior: 'allow', updatedPermissions: [{type: 'addRules', ...}]}`, `Deny` → `{behavior: 'deny', message: ...}`
- [ ] 敏感模式永弹 — handler 端 hard-coded list: `rm -rf /, chmod 777, mkfs, dd, git push --force, curl | sh`
- [ ] In-memory permit 缓存 — 同 session 内同工具同 args 二次确认自动 allow
- [ ] **不返回 null** — null = SDK 永久阻塞(fail-closed), 必须 resolve
- [ ] Plan mode exit 路径 — `permissionMode: 'plan'` 时 `ExitPlanMode` 协议走相同 handler, 返 `setMode: default`
- [ ] **守门契约**: 配 `options.permissionPromptToolName` 在 session 启动时, **不能 init 时静态挂**
- [ ] 单测: mock SDK, 触发 MCP tool → 验证 handler 协议 + SSE 推送 + 决议路由
- [ ] Seam 2 RED e2e 测试覆盖
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
