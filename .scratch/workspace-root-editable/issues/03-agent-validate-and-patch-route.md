---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 02
Blocks: 05, 07
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 03: agent `validate-path` 端点 + PATCH 强制校验

## 背景

ADR-0037 D3 / D6: settings 改 root 必须**前端 + 后端双层校验**;前端 debounce 调 `POST /api/workspace/validate-path` 拿 hint, 后端 PATCH 强制校验拒绝非法值。

## 目标

新增 `POST /api/workspace/validate-path`(只读 hint);改造 `PATCH /api/workspace/config` 走 `validatePath` + 返 400 with errorCode;新增 3 个错误码。

## 改动清单

### apps/agent

| # | 文件 | 改动 |
|---|---|---|
| 1 | [apps/agent/src/routes/workspace.ts](../../apps/agent/src/routes/workspace.ts) | 新增 `POST /api/workspace/validate-path` route: body `{ path: string }` → 调 `WorkspaceService.validatePath(path)` → 返 `{ exists, isWorkspace, errorCode? }` |
| 2 | 同上 | 改造 `PATCH /api/workspace/config`:先调 `validatePath(patch.workspaceRoot)`, 命中 `errorCode` → 返 400 `{ error: errorCode, message: ... }`;成功 → 走原 `updateConfig` 路径 |
| 3 | [apps/agent/src/error-codes.ts](../../apps/agent/src/error-codes.ts) | 新增 `E_WS_ROOT_PATH_NOT_EXISTS` / `E_WS_ROOT_PATH_NOT_WORKSPACE` / `E_AGENT_RESTART_FAILED`(后者被 issue 04 引入) |
| 4 | [apps/agent/src/__tests__/workspace-route-validate.test.ts](../../apps/agent/src/__tests__/workspace-route-validate.test.ts) | 新建:7 case(validate-path 4 + PATCH 校验 3) |

### 不动(明确)

- `WorkspaceService.updateConfig()`(本 issue 不动; 仅在 PATCH route 层加校验)
- `WorkspaceService.validatePath()`(issue 02 已写)

## 验收

- [ ] agent 编译通过
- [ ] 新单测 7 case 全过
- [ ] agent 全套件零 regression
- [ ] 手动 `curl -X POST /api/workspace/validate-path -d '{"path":"/nonexistent"}'` 返 400 + errorCode
- [ ] 手动 `curl -X PATCH /api/workspace/config -d '{"workspaceRoot":"/tmp/newplace"}'` (目录不存在) 返 400 `E_WS_ROOT_PATH_NOT_EXISTS`