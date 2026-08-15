---
Status: ready-for-agent
Type: task
Created: 2026-08-15
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 09, 10, 11
Blocks: 无
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
Supersedes: 无(后续可能新增 ADR-0031 跟进)
---

# Issue 12: `branchName` 与 upstream 默认分支同名时前置校验 + ADR 跟进

## 背景

Issue 09-11 解决了「残留 `.git` 怎么办」的兜底问题,但**没有消除根本触发场景**:`branchName` 与 upstream 默认分支同名(典型:用户填 `main` 或 `master`)时,`git checkout -b <branchName>` 会失败:

```
fatal: A branch named 'main' already exists.
```

当前 [`CodebaseManager.clone()`](apps/agent/src/codebase/CodebaseManager.ts#L208) 第 2 步失败后 `safeRm` 兜底 —— 但用户体验差:
- 用户看到 `cloning` → `failed` 红色 banner
- 日志里出现 `safeRm gave up after 3 retries`
- 用户搞不清楚为什么「明明 branchName 是合法字符」却失败

本 issue 在 `attachRepo` 入口前置拦截,避免走 `git checkout -b` 必败路径。

## 目标

1. `RequirementService.attachRepo` 在调 `codebaseMgr.clone` 之前,先 `ls-remote --symref <gitUrl> HEAD` 拿 upstream 默认分支名,与用户输入 `branchName` 比对
2. 同名 → 返 `E_BRANCH_EXISTS`(新增错误码,**这意味着 ADR-0030 D5 决策 111 要更新**)
3. 提交新增 ADR-0031(后续 ADR)记录这次契约变更

## 子项

### 12.1 引入 `E_BRANCH_EXISTS` 错误码

[`packages/shared/src/worktree.ts`](packages/shared/src/worktree.ts) 加:

```typescript
export enum RepoAttachErrorCode {
  // ... 现有 6 个
  E_BRANCH_EXISTS, // 新增:branchName 与 upstream 默认分支同名
}
```

注意:
- 当前 `mapCloneError`([`CodebaseManager.ts:436`](apps/agent/src/codebase/CodebaseManager.ts#L436)) 注释说「没有 E_BRANCH_EXISTS(全新 clone 不可能撞本地分支,决策 111)」 —— **这里说的是错的**
  - `git clone` 不会撞本地分支(因为新建仓库,本地无分支)
  - 但 `git checkout -b <branchName>` 会撞 —— 因为 clone 后本地默认分支已经存在
- 本 issue 修正决策 111 的边界:**`E_BRANCH_EXISTS` 在「branchName 与 origin 默认分支同名」时使用**
- `mapCloneError` 注释更新:把「全新 clone 不可能撞本地分支」改成「全新 clone 不撞,但 checkout -b 可能撞(决策 111-v2)」

### 12.2 `RequirementService.attachRepo` 加前置校验

[`apps/agent/src/services/RequirementService.ts:280`](apps/agent/src/services/RequirementService.ts#L280) 在 `codebaseMgr.clone` 之前加:

```typescript
// 4. 前置校验:branchName 不能与 upstream 默认分支同名
//    (避免走到 git checkout -b 必败路径,产生孤儿 .git)
const defaultBranch = await this.fetchDefaultBranch(git, entry.gitUrl)
if (defaultBranch && defaultBranch === branchName) {
  await this.codebaseMgr.clearPending(reqId, repoName) // 与成功路径一致
  this.broadcastProgress(reqId, repoName, 'failed',
    `branchName "${branchName}" 与 upstream 默认分支同名,无法创建`,
  )
  return {
    ok: false,
    repoName,
    code: RepoAttachErrorCode.E_BRANCH_EXISTS,
    message: `branchName "${branchName}" 与 ${entry.gitUrl} 默认分支同名`,
  }
}
```

并在 `RequirementService` 内加私有方法:

```typescript
/**
 * `git ls-remote --symref <gitUrl> HEAD` 拿 upstream 默认分支名
 * - 成功 → 返回分支名(如 'main' / 'master')
 * - 失败(网络 / 鉴权 / 仓库空)→ 返回 null(不阻断 attach 流程)
 */
private async fetchDefaultBranch(
  git: GitExec,
  gitUrl: string,
): Promise<string | null> {
  try {
    const res = await git(['ls-remote', '--symref', gitUrl, 'HEAD'])
    if (res.code !== 0) return null
    // stdout 格式: "ref: refs/heads/main\t<commit-sha>"
    const match = res.stdout.match(/ref:\s*refs\/heads\/(\S+)/)
    return match ? (match[1] ?? null) : null
  } catch {
    return null
  }
}
```

`RequirementServiceDeps` 加 `git?: GitExec` 字段(已存在,本次让 `attachRepo` 用上)。

### 12.3 提交 ADR-0031

新增 [`docs/adr/0031-branch-name-vs-default-branch.md`](docs/adr/0031-branch-name-vs-default-branch.md):

```markdown
---
Status: accepted
Created: 2026-08-15
Implements: .scratch/repo-registry-clone/issues/12-branch-name-vs-default-branch.md
Supersedes: ADR-0030 D5 决策 111(部分)
---

# ADR-0031: branchName 与默认分支同名时前置校验

## Context
ADR-0030 D3 + Issue 03 实现 `git clone + git checkout -b` 流程,clone 完成后
本地已存在 upstream 默认分支(如 main),`git checkout -b <branchName>` 在
branchName === 默认分支时报 fatal。

ADR-0030 D5 决策 111 注释「全新 clone 不可能撞本地分支」边界理解错误:
clone 不会撞,但 checkout -b 会撞。

## Decision
1. 新增错误码 E_BRANCH_EXISTS(RepoAttachErrorCode 联合扩展)
2. attachRepo 入口先跑 `git ls-remote --symref <gitUrl> HEAD`,与 branchName 比对
3. 同名 → 返 E_BRANCH_EXISTS,不调 git clone(避免产生孤儿 .git)
4. ls-remote 失败(网络 / 鉴权 / 仓库空)→ 返回 null,不阻断(降级为让原 git checkout -b
   失败路径处理,与现有 E_NETWORK 等错误码一致)

## Consequences
- attachRepo 多一次 ls-remote 网络调用,但只在「branchName 命中常见默认名」前提前,
  实际只多 ~200ms latency
- RepoAttachErrorCode 联合扩展,前端 DraftingRepo Attach 组件需新增 case 处理
- 不破坏现有契约:happy path 完全不变

## Alternatives Considered
- A. 在 frontend 拦截(attach-repos-dialog BRANCH_FORBIDDEN_RE 加 main/master)——
  否决:多语言 / 多平台 default 分支名(main / master / develop / trunk 等),穷举会漏
- B. 用 `git init <dir>` + 手工 fetch + checkout,完全跳过 clone 默认分支——
  否决:偏离 ADR-0030 D3 决策「独立 git clone」语义
```

## 验收清单

- [ ] `RepoAttachErrorCode.E_BRANCH_EXISTS` 加进 `packages/shared/src/worktree.ts`,同步 `PER_REPO_ERROR_CODES` 联合类型
- [ ] `RequirementService.attachRepo` 加 `fetchDefaultBranch` 前置校验,同名返 `E_BRANCH_EXISTS`
- [ ] `mapCloneError` 注释修正(决策 111 边界更新)
- [ ] 新增 ADR-0031 文档
- [ ] 单元测试:
  - `attachRepo` 在 branchName === upstream default 时返 `E_BRANCH_EXISTS`,**不调 clone**
  - `fetchDefaultBranch` 处理 ls-remote 失败(网络 / 鉴权 / stdout 无 symref)→ 返 null
  - 正常 branchName(非默认)→ 走原 clone 路径,行为不变
- [ ] e2e 测试(`repos-attach-clone.e2e.test.ts` 加 case):
  - 准备 fixture,默认分支 main;POST `branchName: 'main'` → 返 `E_BRANCH_EXISTS`
  - POST `branchName: 'feat/x'` → 成功(回归测试)
- [ ] 现有 `repos-attach-clone.e2e.test.ts` + `requirement-attach-async.test.ts` 全 GREEN
- [ ] 前端 `attach-repos-dialog.tsx` 在拿到 `E_BRANCH_EXISTS` 时显示红色 banner「分支名与上游默认分支冲突,请改名」

## 风险

- 多一次 `git ls-remote --symref` 网络调用:对 attach 这种低频操作(< 10 次/用户/天)影响可忽略
- ls-remote 在仓库私密 / 鉴权失败时可能 hang —— 已有 `createDefaultGitExec` 强制 env(Issue 05)+ 5min timeout 兜底
- 新增错误码会破前端未处理的 case —— 必须前端同步更新(在 attach-repos-dialog.tsx 显示特定文案)

## 依赖

- 强依赖 Issue 09(safeRm 兜底) + Issue 10(orphan 自愈)+ Issue 11(working tree 自检) —— 这些保证即使绕过前置校验出问题也不会留脏状态
- 本 issue 是「根治」,前三个是「兜底」

## 不在范围

- 不处理 `branchName` 含有 `@{` / `..` / `\` 等 git 拒绝的非法字符 —— 已有 [`validateBranchName`](packages/shared/src/) strict 模式拦截
- 不处理「用户故意覆盖 upstream 默认分支」(如要 reset origin/main) —— 是后续可能的新需求

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3 / D5](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- Issue 03(checkout -b 流程初版)
- Issue 09 / 10 / 11(兜底层修复)