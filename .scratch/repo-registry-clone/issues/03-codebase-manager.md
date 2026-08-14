---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 01, 04
Blocks: 06, 08
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 03: CodebaseManager 替换 WorktreeManager + 异步 attach

## 目标

把 `apps/agent/src/worktree/WorktreeManager.ts` 整个删掉，新建 `apps/agent/src/codebase/CodebaseManager.ts`，并把 `RequirementService.attachRepos` 从同步串行改为异步并行 + SSE 进度推送 + pending 标记落盘。

## 子项

### 3.1 `apps/agent/src/codebase/CodebaseManager.ts` 新建

```typescript
export interface CodebaseInfo {
  /** 绝对路径，OS-native */
  path: string
  /** 当前分支名（含 origin/ 前缀剥离） */
  branch: string | null
  /** clone 下来的 HEAD commit */
  head: string
}

export interface CodebaseManager {
  /** 异步 clone + checkout 分支；返回 { ok: true, head } 或 { ok: false, code, message } */
  clone(reqId: string, repoName: string, gitUrl: string, branchName: string): Promise<CloneResult>
  /** 异步 rm -rf，半成品目录直接清 */
  remove(reqId: string, repoName: string): Promise<void>
  /** 列某个 repo 的 codebase 信息（按 requirementId 聚合） */
  listByRepo(repoName: string): Promise<CodebaseByReq[]>
  /** 写/清 pending 标记 */
  setPending(reqId: string, repoName: string): Promise<void>
  clearPending(reqId: string, repoName: string): Promise<void>
  /** agent 启动扫残留 pending */
  scanOrphanedPending(): Promise<Array<{ reqId: string; repoName: string; path: string }>>
}
```

实现要点：
- `clone` 内部命令：`git clone <gitUrl> <codebasePath>` → `cd <codebasePath> && git checkout -b <branchName>`
- 依赖 `gitExec` + 强制 env（issue 05）
- `setPending` 写 `codebase/.pending-<name>`（空文件，touch 一下即可）
- `scanOrphanedPending` 扫所有 `requirements/*/codebase/.pending-*` → 对每个先 rm 半成品目录再清标记

### 3.2 删除 `WorktreeManager.ts`

- 物理删除 `apps/agent/src/worktree/WorktreeManager.ts`
- 删除 `RequirementService` / `attachRepo` / `attachRepos` 中所有引用
- 旧 e2e 测试 `apps/agent/src/__tests__/repos-attach.e2e.test.ts` 整个删除（被新测试替代）

### 3.3 `RequirementService.attachRepos` 改异步并行

```typescript
async attachRepos(
  reqId: string,
  repoNames: readonly string[],
  branchName: string,
): Promise<AttachRepoResult[]> {
  // 0. 校验
  for (const name of repoNames) {
    if (!workspaceService.findRepoByName(name)) {
      return [{ ok: false, repoName: name, code: 'E_REPO_NOT_FOUND', message: `注册表无 ${name}` }]
    }
  }

  // 1. 并行 + 异步任务
  const tasks = repoNames.map((name) =>
    this.codebaseMgr.clone(reqId, name, registry[name].gitUrl, branchName)
      .then<AttachRepoResult>((res) =>
        res.ok
          ? { ok: true, repoName: name, branch: branchName, codebasePath: res.path, base: 'main' }
          : { ok: false, repoName: name, code: res.code, message: res.message }
      )
  )
  const results = await Promise.allSettled(tasks)

  // 2. 任一成功 → 写 meta.yaml（保留 SSR 持久化契约）
  if (results.some((r) => r.status === 'fulfilled' && r.value.ok)) {
    this.persistBranchName(reqId, branchName)
  }

  return results.map((r) =>
    r.status === 'fulfilled' ? r.value : { ok: false, repoName: '?', code: 'E_INTERNAL', message: String(r.reason) }
  )
}
```

### 3.4 SSE 进度推送

**不**把 SSE 推到 `CodebaseManager` 里（避免耦合），而是在 `RequirementService.attachRepos` 内部通过 `SseHub` 推：

```typescript
// 在 attachRepos 里
for (const name of repoNames) {
  sseHub.broadcastRequirementEvent(reqId, {
    type: 'repo-clone-progress',
    repoName: name,
    status: 'pending',
  })
  // ... 启动 clone
  // clone 完成后推：
  sseHub.broadcastRequirementEvent(reqId, {
    type: 'repo-clone-progress',
    repoName: name,
    status: result.ok ? 'ready' : 'failed',
    error: result.ok ? undefined : result.message,
  })
}
```

事件类型（新增到 `requirementEventsRoute`）：
```typescript
type RepoCloneProgressEvent = {
  type: 'repo-clone-progress'
  repoName: string
  status: 'pending' | 'cloning' | 'ready' | 'failed'
  error?: string
  ts: number
}
```

### 3.5 测试

- `apps/agent/src/__tests__/codebase/CodebaseManager.test.ts`：单元测试 + fake gitExec
- `apps/agent/src/__tests__/requirement-attach-async.test.ts`：mock CodebaseManager + 验证 Promise.allSettled + meta.yaml 写时机
- `apps/agent/src/__tests__/repos-attach-clone.e2e.test.ts`：**新建**真实 git clone e2e（替换被删的 `repos-attach.e2e.test.ts`）
  - 用 tmp 目录 + bare git 仓库 fixture（`git init --bare upstream.git` + `git clone upstream.git local`）
  - 验证：clone 成功 / 目录已存在 `E_REPO_ALREADY_ATTACHED` / clone 中途失败 `rm -rf` 清理

### 3.6 启动扫残留

在 `apps/agent/src/server.ts` 启动路径里加：

```typescript
const orphans = await codebaseMgr.scanOrphanedPending()
for (const { reqId, repoName, path } of orphans) {
  log.warn(`cleaning orphaned clone: ${path}`)
  await rm(path, { recursive: true, force: true })
}
```

## 验收清单

- [ ] `WorktreeManager.ts` 物理删除
- [ ] `CodebaseManager.ts` 实现完整（clone / remove / list / setPending / clearPending / scanOrphanedPending）
- [ ] `RequirementService.attachRepos` 并行 clone + 任一成功写 `meta.yaml`
- [ ] SSE 推送 `repo-clone-progress` 事件（`pending` → `cloning` → `ready` / `failed`）
- [ ] clone 中途失败 → 半成品 `rm -rf` + pending 标记清
- [ ] agent 启动扫残留 pending → 清半成品 + log warn
- [ ] 新 e2e 测试（`repos-attach-clone.e2e.test.ts`）全 GREEN
- [ ] 旧 `repos-attach.e2e.test.ts` 已删

## 风险

- `Promise.allSettled` 让前端无法实时看到进度——必须在每个 `clone` 内部推 `cloning` 事件，不能只在 `Promise.allSettled` 之后
- `scanOrphanedPending` 在 workspace 巨大时（数千需求）扫得慢——可优化为「只扫最近启动过 clone 的需求」，但本期先做简单全扫

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q8 / Q10 / Q13 / C3](../decisions.md)
