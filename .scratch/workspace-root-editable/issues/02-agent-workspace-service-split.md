---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 01
Blocks: 03, 04
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 02: agent `WorkspaceService` 拆分(configDir / dataRoot) + 启动算法重写

## 背景

ADR-0037 D1 / D2:agent 进程启动要分清 `configDir` (env 或 `~/.aidevspace`, 放 config.yaml) 与 `dataRoot` (yaml.workspaceRoot 或 configDir, 放数据)。当前 `WorkspaceService` 把两者合一(`this.root` 同时是 configPath 父目录 + 数据目录)。

## 目标

`WorkspaceService` constructor 拆分;新增 `resolveConfigDir` / `resolveDataRoot` 双阶段解析;`initWorkspace` / `getWorkspaceInfo` / `updateConfig` / `validatePath` 全部走新模型。

## 改动清单

### apps/agent

| # | 文件 | 改动 |
|---|---|---|
| 1 | [apps/agent/src/services/WorkspaceService.ts](../../apps/agent/src/services/WorkspaceService.ts) | 拆 constructor: 新增 `configDir` / `dataRoot` 两字段;保留 `root` alias (deprecated, 一期内移除); `configPath` 改用 `configDir`;新增 `dataPath()` 工具函数 |
| 2 | 同上 | `static resolveRoot(env)` → 拆为 `static resolveConfigDir(env)`(env > ~/.aidevspace, normalize);新增 `static resolveDataRoot(configDir)`:读 `<configDir>/config.yaml`, 字段空 fallback `configDir` |
| 3 | 同上 | 新增 `static async fromEnv(env)`:调 `resolveConfigDir` → `resolveDataRoot` → 构造 service 实例 |
| 4 | 同上 | `initWorkspace()`:子目录(`requirements/` 等)建在 `dataRoot`; `config.yaml` 写在 `configDir`; 当 `configDir !== dataRoot` 时不 seed `dataRoot/config.yaml`(由 settings 接管) |
| 5 | 同上 | `getWorkspaceInfo()`: 返 `configDir` + `dataRoot` 两个字段; `configPath` = configDir 路径 |
| 6 | 同上 | 新增 `validatePath(p: string)` 公开方法:复用 shared `validateWorkspaceRoot` + fs 检查 |
| 7 | [apps/agent/src/server.ts](../../apps/agent/src/server.ts) | `WorkspaceService` 构造改走 `await WorkspaceService.fromEnv(process.env)`(同步 → 异步) |
| 8 | [apps/agent/src/__tests__/workspace-service-split.test.ts](../../apps/agent/src/__tests__/workspace-service-split.test.ts) | 新建:8 case(env 优先 / env 缺默认 / yaml 字段空 fallback / yaml 字段有 normalize / env 用户 yaml 切换 / initWorkspace 双目录 / getWorkspaceInfo 双字段 / validatePath 路径) |

### 不动(明确)

- `apps/agent/src/services/board/...` 等下游 service(本期只动 WorkspaceService,下游用 `this.root` 兼容 alias 暂时无破坏)
- `requirements-root.server.ts`(web 端,本期不动;issue 03 后才会对齐)

## 验收

- [ ] agent 编译通过
- [ ] 新单测 8 case 全过
- [ ] agent 全套件 1271+ 个 case 零 regression(向下兼容 `this.root` alias 兜底)
- [ ] 手动跑 `pnpm dev` 启动 agent, 确认 `curl http://localhost:7777/api/workspace` 返 `configDir` + `dataRoot` 两个字段

## 风险

| 风险 | 缓解 |
|---|---|
| 现有 100+ 调用点用 `this.root` | 保留 `root` getter 返回 `dataRoot`, 全套件 100% 通过即可发现 regression |
| 异步构造 vs 旧同步 | server.ts 单点改动, 影响范围可控 |