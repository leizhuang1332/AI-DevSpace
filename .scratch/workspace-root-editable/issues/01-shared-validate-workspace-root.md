---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 无
Blocks: 02, 03, 05
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 01: shared 层 `validateWorkspaceRoot` 纯函数 + zod schema

## 背景

ADR-0037 D3 要求 settings 改 root 时**前端 + 后端双层校验**,且 trace 判定逻辑**必须**前后端共用(避免前端 hint 绿、后端拒绝 400 的不一致)。

## 目标

在 `packages/shared` 新增 `validateWorkspaceRoot()` 纯函数 + zod schema,供 web / agent 双方复用。

## 改动清单

### packages/shared

| # | 文件 | 改动 |
|---|---|---|
| 1 | [packages/shared/src/workspace-schema.ts](../../packages/shared/src/workspace-schema.ts) | 新建:导出 `WorkspaceValidation { exists: boolean; isWorkspace: boolean; errorCode?: 'E_WS_ROOT_PATH_NOT_EXISTS' \| 'E_WS_ROOT_PATH_NOT_WORKSPACE' }` zod schema + `validateWorkspaceRoot(p: string): WorkspaceValidation` 纯函数(trace 判定 = `requirements/` / `knowledge/` / `skills/` / `analysis-skills/` 任一存在,沿用 ADR-0037 D3 超集定义);**Node-only fs**调用(`existsSync`)封装在 `validateWorkspaceRootFs` 子函数里,前端 import 时用 polyfill-friendly 形态 |
| 2 | [packages/shared/src/index.ts](../../packages/shared/src/index.ts) | export `WorkspaceValidation` / `validateWorkspaceRoot` |
| 3 | [packages/shared/src/__tests__/workspace-schema.test.ts](../../packages/shared/src/__tests__/workspace-schema.test.ts) | 新建:6 case(路径不存在 / 空目录 / 仅 requirements / 仅 knowledge / 仅 skills / 仅 analysis-skills) |

### 不动(明确)

- `packages/shared/src/pathUtil.ts`(`normalizeWorkspaceRoot` 已存在,继续复用)
- `packages/shared/src/config-defaults.ts`(`workspaceRoot: ''` 默认值本 issue 不动,留 issue 02 同步)

## 验收

- [ ] `validateWorkspaceRoot('/nonexistent')` → `{ exists: false, errorCode: 'E_WS_ROOT_PATH_NOT_EXISTS' }`
- [ ] `validateWorkspaceRoot(tmpEmptyDir)` → `{ exists: true, isWorkspace: false, errorCode: 'E_WS_ROOT_PATH_NOT_WORKSPACE' }`
- [ ] `validateWorkspaceRoot(tmpWithRequirements)` → `{ exists: true, isWorkspace: true }`
- [ ] `validateWorkspaceRoot(tmpWithOnlySkills)` → `{ exists: true, isWorkspace: true }`(超集定义生效)
- [ ] shared 编译通过 + 单测 6 case 全过
- [ ] agent / web 端**未**在本 issue 引入(仅 schema + 测试);issue 02 / 03 / 05 才接