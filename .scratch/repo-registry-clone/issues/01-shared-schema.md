---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 无
Blocks: 02, 03, 06
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 01: shared 包 schema 改造 + ADR 落档

## 目标

把「仓库条目」「需求关联仓库」「错误码」三套契约按 ADR-0030 D1/D3/D5 重写。**这是后续所有 ticket 的契约源头**——必须在 issue 02/03/06 之前完成。

## 子项

### 1.1 ADR-0030 + superseded 标记（已完成）

- [x] `docs/adr/0030-repo-registry-and-per-requirement-clone.md` 新建
- [x] `docs/adr/0003-git-worktree-isolation.md` 顶部加 `Status: Superseded by ADR-0030` + 引用段
- [x] `docs/adr/0016-attach-repos-real-pool.md` 顶部加 `Status: Partially superseded by ADR-0030` + 引用段
- [x] `CONTEXT.md` 版本号 → v1.0.7；术语段 Repository/RepoPool 重写 + 新增 Codebase；新增 v1.0.7 增量决策 104-118

### 1.2 `packages/shared/src/repos.ts` 改造

**新增**：

```typescript
export const RepoRegistryEntrySchema = z.object({
  name: z.string().min(1).max(100),
  gitUrl: z.string().min(1).max(500),
  description: z.string().max(500),
})

export const RepoRegistrySchema = z.object({
  version: z.literal(1),
  repos: z.array(RepoRegistryEntrySchema),
})

export const RepoRegistryResponseSchema = z.object({
  repos: z.array(RepoRegistryEntrySchema),
})
```

**删除**（旧 `RepoPoolEntrySchema` / `ReposResponseSchema`，被取代）：

```typescript
// 旧 — 删除
export const RepoPoolEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})
export const ReposResponseSchema = z.object({ repos: z.array(RepoPoolEntrySchema) })
```

### 1.3 `packages/shared/src/worktree.ts` 改造

**改写**：

```typescript
// 旧 repoIds → 新 repoNames；旧 repoId → 新 repoName；旧 worktreePath → 新 codebasePath
export const AttachReposRequestSchema = z.object({
  repoNames: z.array(z.string().min(1).max(100)).min(1).max(50),
  branchName: z.string().min(1).max(100),
})

export const AttachRepoResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    repoName: z.string(),
    branch: z.string(),
    codebasePath: z.string(),
    base: z.enum(['main', 'master']),  // 仅保留这两个可能值
  }),
  z.object({
    ok: z.literal(false),
    repoName: z.string(),
    code: z.enum(PER_REPO_ERROR_CODES),
    message: z.string(),
  }),
])

export const AttachReposResponseSchema = z.object({
  requirementId: z.string(),
  branchName: z.string(),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
  results: z.array(AttachRepoResultSchema),
})
```

**错误码**：

```typescript
export const RepoAttachErrorCode = {
  E_AUTH: 'E_AUTH',
  E_DISK_FULL: 'E_DISK_FULL',
  E_INVALID_BRANCH_NAME: 'E_INVALID_BRANCH_NAME',
  E_REPO_NOT_FOUND: 'E_REPO_NOT_FOUND',     // 语义改：注册表无此条目
  E_REPO_NAME_EXISTS: 'E_REPO_NAME_EXISTS', // 新增：POST /api/repos 时 name 重复
  E_REPO_ALREADY_ATTACHED: 'E_REPO_ALREADY_ATTACHED', // 新增：codebase/<name>/ 已存在
  E_REQUIREMENT_NOT_FOUND: 'E_REQUIREMENT_NOT_FOUND',
  E_NETWORK: 'E_NETWORK',
  E_INTERNAL: 'E_INTERNAL',
  // 删除：E_BASE_BRANCH_NOT_FOUND, E_BRANCH_EXISTS
} as const

const PER_REPO_ERROR_CODES = [
  'E_DISK_FULL',
  'E_NETWORK',
  'E_AUTH',
  'E_REPO_NOT_FOUND',
  'E_REPO_ALREADY_ATTACHED',
  'E_INTERNAL',
] as const
```

### 1.4 测试覆盖

- `packages/shared/src/__tests__/repos.test.ts` 新增：所有 schema 校验 + 错误码枚举完整
- `packages/shared/src/__tests__/worktree.test.ts` 改写：`repoNames` / `codebasePath` 字段生效；旧字段名（`repoIds` / `worktreePath`）全部失效（Zod 拒绝）

## 验收清单

- [ ] ADR-0030 文件可读、无 lint error
- [ ] ADR-0003 / 0016 顶部有 superseded 标记 + 引用段
- [ ] CONTEXT.md 版本号更新到 v1.0.7，术语段 + 决策 104-118 完整
- [ ] `RepoRegistryEntrySchema` 拒绝 `id` 字段（多余字段忽略），要求 `name/gitUrl/description` 三字段齐全
- [ ] `AttachReposRequestSchema` 拒绝 `repoIds`，接受 `repoNames`
- [ ] `AttachRepoResult.ok=true` 必须有 `codebasePath` 无 `worktreePath`
- [ ] 错误码枚举不含 `E_BASE_BRANCH_NOT_FOUND` / `E_BRANCH_EXISTS`；含 `E_REPO_ALREADY_ATTACHED` / `E_REPO_NAME_EXISTS`
- [ ] 既有引用旧 schema 的测试全 RED（issue 02/03/06 接管修复）

## 风险

- 任何下游消费方（`apps/agent` / `apps/web`）未跟改都会跑挂——issue 02/03/06 是修复侧
- `repos-attach.e2e.test.ts` 整文件改写（在 issue 03 范围内）

## 引用

- [PRD FR-1.1-1.4](../PRD.md#fr-1-注册表读写)
- [ADR-0030 D1 / D5](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q4 / C1 / C4](../decisions.md)
