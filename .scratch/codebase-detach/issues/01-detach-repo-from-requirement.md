---
Status: ready-for-agent
Type: task
Created: 2026-08-16
Feature: codebase-detach
Parent: .scratch/codebase-detach/PRD.md
Blocked by: 无
Blocks: 无
ADR: docs/adr/0034-detach-requirement-codebase.md
Supersedes: 无
---

# Issue 01: 需求级 codebase detach 端到端实施

## 背景

DRAFTING 页面 RepoBar 展开态 chip 上的红色 ✕ 按钮当前只更新前端 React state,
后端从未收到请求。10 条 grill-with-docs 共识已锁,见 `decisions.md`。

## 用户原始诉求

> 增加取消关联仓库功能,触发节点:RepoBar 上某仓库 chip 的红色 ✕ 按钮。
> 预期结果:codebase/ 目录下删除对应仓库。

## 目标

实现从 UI 点击到 fs 真删的端到端流程,见 ADR-0034 Architecture 总览。

## 改动清单

### 后端

| # | 文件 | 改动 |
|---|---|---|
| 1 | [packages/shared/src/requirement.ts](../../packages/shared/src/requirement.ts) | 追加 `DetachRepoErrorCode` 常量 + `DetachRepoResult` 类型 export |
| 2 | [apps/agent/src/services/RequirementService.ts](../../apps/agent/src/services/RequirementService.ts) | 加 `requirementLocks: Map` + `withRequirementLock`;新增 `detachRepo`;把 `attachRepo` / `attachRepos` 也包锁(Plan agent §7.1);`_attachRepoInner` 是无锁实现 |
| 3 | [apps/agent/src/routes/requirement.ts](../../apps/agent/src/routes/requirement.ts) | 新增 `DELETE /api/requirement/:id/codebase/:name` handler(404 / 409 / 400 / 204 / 500 错误映射) |

### 前端

| # | 文件 | 改动 |
|---|---|---|
| 4 | [apps/web/src/lib/repo-attach.ts](../../apps/web/src/lib/repo-attach.ts) | 新增 `detachCodebase(reqId, repoName)` HTTP 调用封装 |
| 5 | [apps/web/src/components/repos/DetachCodebaseDialog.tsx](../../apps/web/src/components/repos/DetachCodebaseDialog.tsx) | 新建确认弹窗(useState + submitting + error) |
| 6 | [apps/web/src/components/repo-bar.tsx](../../apps/web/src/components/repo-bar.tsx) | 新增 `onRequestDetach` prop;`handleDetach` 优先调它,fallback 到旧 `onDetachRepo`(@deprecated) |
| 7 | [apps/web/src/components/drafting-zone.tsx](../../apps/web/src/components/drafting-zone.tsx) | 新增 `detachTarget` state + `handleDetachConfirm`;渲染 `<DetachCodebaseDialog>` |

### 测试

| # | 文件 | 改动 |
|---|---|---|
| 8 | [apps/agent/src/__tests__/requirement-detach-codebase.test.ts](../../apps/agent/src/__tests__/requirement-detach-codebase.test.ts) | 新建:7 service 单测 + 10 route 集成 |
| 9 | [apps/web/src/__tests__/components/repos/DetachCodebaseDialog.test.tsx](../../apps/web/src/__tests__/components/repos/DetachCodebaseDialog.test.tsx) | 新建 11 dialog 单测 |
| 10 | [apps/web/src/components/__tests__/repo-bar.test.tsx](../../apps/web/src/components/__tests__/repo-bar.test.tsx) | ✕ 测试改用 `onRequestDetach`;新增 onDetachRepo fallback 单测 |
| 11 | [apps/web/src/__tests__/drafting-zone.test.tsx](../../apps/web/src/__tests__/drafting-zone.test.tsx) | 3 个 issue 09 测试适配 dialog 流程;`describe` 块加 fetch mock |
| 12 | [apps/web/src/components/__tests__/drafting-zone.test.tsx](../../apps/web/src/components/__tests__/drafting-zone.test.tsx) | 2 个 issue 09 集成测试适配 dialog 流程 |

### 文档

| # | 文件 | 改动 |
|---|---|---|
| 13 | [docs/adr/0034-detach-requirement-codebase.md](../../docs/adr/0034-detach-requirement-codebase.md) | 新建 ADR |
| 14 | [docs/agents/domain.md](../../docs/agents/domain.md) | 追加 3 条术语:per-requirement codebase / detach / per-requirement mutex |
| 15 | `.scratch/codebase-detach/{PRD,decisions,issues/01-*}.md` | 本目录 |

### 不动(明确列出)

- `apps/agent/src/codebase/CodebaseManager.ts`(`remove` 已存在,直接调用)
- `apps/agent/src/auth/authPlugin.ts`(全局鉴权已覆盖新路由)
- `apps/agent/src/services/WorkspaceService.ts`(只读参考,不动)
- `repos.yaml` 任何写入路径

## 验收

### 后端

- [ ] service 层:`detachRepo` 7 个 case 全过(happy path / N=1→0 / N=2→1 / 404 / 409 / codebase not found / 并发 / rm 抛错)
- [ ] route 层:`DELETE /api/requirement/:id/codebase/:name` 10 个 case 全过(401 / 204 / 404 / 409 / 400 / 500)
- [ ] agent 全套件 1271 个 case 全过(无 regression)
- [ ] 鉴权:无 token → 401(由 `authPlugin` 全局 hook 拦截)

### 前端

- [ ] `DetachCodebaseDialog` 11 case 全过(开关 / 渲染 / 交互 / submitting / error / 重置)
- [ ] `repo-bar` 24 case 全过(原 22 + 改 `onRequestDetach` 2 + 新 fallback 1)
- [ ] `drafting-zone` 集成测试:点 ✕ → dialog → confirm → chip 消失(3 个 issue 09 + 2 个集成)
- [ ] `agentFetch<void>` 204 路径(测试用 mock fetch 返 204)
- [ ] web 全套件 1319/1320 通过(1 个 pre-existing Windows 路径失败与本功能无关)

### 端到端手测(必跑 dev server,见 CLAUDE.md「Next.js dev ↔ build 隔离」)

1. `pnpm dev` 启动
2. 真 attach 一个 repo:在 DRAFTING 页 `关联仓库 → ＋ 添加` 选 1-2 个 repo,提供分支名,确认 attached
3. 验证 fs:`ls ~/.aidevspace/requirements/<reqId>/codebase/<repoName>/` 应有 `.git/` + working tree
4. 验证 meta.yaml:`cat ~/.aidevspace/requirements/<reqId>/meta.yaml` 应有 `branchName: <name>`
5. 点 ✕ → 弹确认框 → 检查文案、按钮禁用
6. 确认 → chip spinner 一瞬,消失;summary 数字 -1;刷新页面,chip 不再出现(`deriveRepos` 重新派生)
7. N=1→0 边界:把所有 repo 都 detach,最后一步后 `cat meta.yaml` 确认 `branchName` 已清
8. 失败回滚:手动让 safeRm 失败(macOS Finder 持有 fd),确认 chip 仍在原位 + toast 报错
9. 状态门禁:手动把 req 状态推进到 ANALYZING(创建 `analysis/` 子目录),确认 ✕ 不再出现 / API 返 409
10. repos.yaml 不动:detach 前 `cat ~/.aidevspace/repos.yaml` 记 hash,detach 后 diff 应为空

## 不做

- 不删 `repos.yaml` 全局条目
- 不动 KB / RAG / 向量索引
- 不扩 ANALYZING / BOARD / WRAP-UP 状态入口
- 不加智能确认
- 不加撤销 toast
- 不改 `CodebaseManager.remove`
- 不走 ADR-0023 MCP 守门