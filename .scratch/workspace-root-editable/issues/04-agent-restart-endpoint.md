---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 02
Blocks: 06, 07
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 04: agent `POST /api/agent/restart` 端点 + SSE `agent-restarting` 事件

## 背景

ADR-0037 D4: settings 改 root 后, agent 进程仍是旧 root; 用户点 `[↻ 重启 Agent]` → SSE 广播 → 清理 → `process.exit(0)` → supervisor 拉起新进程。

## 目标

新增 `POST /api/agent/restart` 端点; SSE 注册 `agent-restarting` 事件类型; 启动期 supervisor 检测启发式(给裸跑 node 的用户打 warning)。

## 改动清单

### apps/agent

| # | 文件 | 改动 |
|---|---|---|
| 1 | [apps/agent/src/routes/agent.ts](../../apps/agent/src/routes/agent.ts) | 新建(若不存在)/扩展: `POST /api/agent/restart` route handler |
| 2 | 同上 | handler 流程: (a) SSE 广播 `{ type: 'agent-restarting', reason: 'workspaceRoot-changed' }` 给所有订阅者; (b) `await closeAllSseConnections()`; (c) `await shutdownSdkSubprocess()`(沿用现有清理入口); (d) `setTimeout(() => process.exit(0), 200)`(给 SSE 200ms flush); 失败 → 500 `E_AGENT_RESTART_FAILED` |
| 3 | [apps/agent/src/server.ts](../../apps/agent/src/server.ts) | SSE event 注册 `agent-restarting` 类型到已有 `@fastify/sse` 通道 |
| 4 | [apps/agent/src/services/AgentLifecycle.ts](../../apps/agent/src/services/AgentLifecycle.ts) | 新建: `closeAllSseConnections()` + `shutdownSdkSubprocess()` 工具(从 server.ts 抽出, 便于单测) |
| 5 | [apps/agent/src/lib/supervisor-detect.ts](../../apps/agent/src/lib/supervisor-detect.ts) | 新建: `detectSupervisor()` 启发式: 检查 `process.env.TSX_WATCH === '1'` / 父进程名含 `tsx` / npm / pm2 / docker; 返回 `{ supervised: boolean, hint: string }` |
| 6 | [apps/agent/src/server.ts](../../apps/agent/src/server.ts) | 启动时调 `detectSupervisor()`, `!supervised` → console.warn `[agent] 当前未在 supervisor 下, POST /api/agent/restart 不会自动拉起新进程` |
| 7 | [apps/agent/src/__tests__/agent-restart-route.test.ts](../../apps/agent/src/__tests__/agent-restart-route.test.ts) | 新建: 5 case (handler happy path / SSE 广播触发 / 清理失败 500 / 进程退出 / supervisor 检测 4 启发式) |

### 不动(明确)

- `@fastify/sse` 全局配置(仅注册新事件类型)
- `authPlugin`(新端点沿用全局鉴权)

## 验收

- [ ] agent 编译通过
- [ ] 新单测 5 case 全过
- [ ] agent 全套件零 regression
- [ ] 手动跑 `pnpm dev`(tsx watch) → `curl -X POST /api/agent/restart -H "X-AIDevSpace-Token: ..."` → agent 退出 → tsx watch 自动拉起 → 重连后 `/api/workspace` 返新 config
- [ ] 手动跑 `node src/server.ts`(裸跑) → 启动期 console 应有 warning

## 风险

| 风险 | 缓解 |
|---|---|
| 进程退出但 supervisor 没拉起 | issue 06 banner + console warning 兜底; 用户须自查 |
| SSE 广播失败但 process.exit 已触发 | 静默(让 supervisor 拉起, web 端靠重连兜底) |
| cleanup 阶段抛错 | 仍走 process.exit(0)(已 exit 的进程无法回退) |