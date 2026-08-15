---
Status: ready-for-agent
Type: task
Created: 2026-08-15
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 无
Blocks: 10, 11
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
Supersedes: 无
---

# Issue 09: `CodebaseManager` safeRm 不静默吞错 + existsSync → valid repo 检查

## 背景

需求关联仓库后，截图显示 `requirements/<req-id>/codebase/<repoName>/` 目录下**只有 `.git` 一个子目录、没有 working tree 文件**。代码 ([`CodebaseManager.ts:218`](apps/agent/src/codebase/CodebaseManager.ts#L218)) 检查 `existsSync(codebasePath)` 命中 `E_REPO_ALREADY_ATTACHED`，**不再重新 clone** —— 但实际状态是「上一次 attach 半成品残留」。

根因链：
1. 上一次 attach 走到 `git checkout -b <branchName>` 失败路径（典型场景：`branchName` 与 origin 默认分支同名 → `fatal: A branch named 'main' already exists`；或 git 进程被 SIGTERM 中断）
2. `safeRm(codebasePath)`（[`CodebaseManager.ts:475`](apps/agent/src/codebase/CodebaseManager.ts#L475)）试图 `rmSync(p, {recursive, force})`，但 macOS Finder / Spotlight / 任何进程持有 fd 时 `rm -rf` 会 `ENOTEMPTY` / `EACCES` 失败
3. `safeRm` 内部 `try/catch` **swallow 所有错误、不抛、不日志** → `.git` 残留
4. 残留 `.git` 落在 `codebase/<repoName>/` 下 → 下次 attach 命中 `E_REPO_ALREADY_ATTACHED` → **永久 working tree 空**

本 issue 解决根因链第 2、4 步。

## 目标

1. `safeRm` 不再静默吞错 —— 失败必须可观测（log warn），且在 fd 竞争下用 retry 兜底
2. `existsSync(codebasePath)` 改为「valid repo 检查」：只有 `codebase/<repoName>/` 真的是一个**完整 git 仓库 + 有 working tree** 时才短路

## 子项

### 9.1 `safeRm` 加 logger 参数 + retry 兜底

[`apps/agent/src/codebase/CodebaseManager.ts:475`](apps/agent/src/codebase/CodebaseManager.ts#L475) 改为：

```typescript
interface SafeRmLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void
}

/**
 * rm -rf 兜底:目录可能不存在,任何错误都 swallow(清理不应抛)
 * —— 但**不再**静默:失败必须 warn;fd 竞争下 retry 3 次兜底
 */
async function safeRm(
  p: string,
  logger?: SafeRmLogger,
): Promise<void> {
  const tryRm = (): boolean => {
    try {
      rmSync(p, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
  if (tryRm()) {
    if (!existsSync(p)) return
    logger?.warn({ path: p }, 'safeRm: directory still exists after rmSync')
  } else {
    logger?.warn({ path: p }, 'safeRm: rmSync threw, will retry')
  }
  // fd 竞争 retry:macOS Finder/Spotlight 索引偶尔会持有 fd,等 100ms 重试
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (tryRm() && !existsSync(p)) return
  }
  logger?.warn(
    { path: p },
    'safeRm: gave up after 3 retries, directory may persist',
  )
}
```

调用点（`clone()` 函数第 2 步 checkout 失败的两处、`remove()` 一处）必须注入 logger：
- `clone` 闭包内 `logger` 通过 `CodebaseManagerDeps` 注入（新增可选字段，向后兼容）
- `remove` 同上

### 9.2 新增 `isCompleteCodebase(path)` 工具函数

[`apps/agent/src/codebase/CodebaseManager.ts`](apps/agent/src/codebase/CodebaseManager.ts) 内新增：

```typescript
/**
 * 「codebase 路径是不是一个完整 git 仓库 + working tree」
 * - 仅 .git 存在但 working tree 为空(残留半成品)→ false
 * - 完整仓库 + 至少有 1 个 tracked 文件 → true
 * - 不存在 → false
 *
 * 实现:<path>/.git/HEAD 存在 + `git -C <path> ls-files | head -1` 成功且非空
 */
async function isCompleteCodebase(
  git: GitExec,
  path: string,
): Promise<boolean> {
  if (!existsSync(path)) return false
  const gitHead = join(path, '.git', 'HEAD')
  if (!existsSync(gitHead)) return false
  try {
    const res = await git([
      '-C', toPosixPath(path),
      'ls-files',
    ])
    if (res.code !== 0) return false
    return res.stdout.trim().length > 0
  } catch {
    return false
  }
}
```

### 9.3 `clone()` 入口改用 `isCompleteCodebase`

[`apps/agent/src/codebase/CodebaseManager.ts:218`](apps/agent/src/codebase/CodebaseManager.ts#L218) 改为：

```typescript
// 0. 路径已存在 + 是完整仓库 → E_REPO_ALREADY_ATTACHED(幂等校验)
//    路径已存在但**不完整**(残留半成品) → safeRm 后继续 clone
const existing = existsSync(codebasePath)
const isComplete = existing && (await isCompleteCodebase(git, codebasePath))
if (existing && isComplete) {
  return {
    ok: false,
    code: RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED,
    message: `codebase ${repoName} 已被 req ${reqId} 关联`,
  }
}
if (existing && !isComplete) {
  // 孤儿半成品:log warn + safeRm + 继续 clone
  fastifyLogger?.warn?.(
    { reqId, repoName, path: codebasePath },
    'clone: found orphan half-baked codebase, removing before retry',
  )
  await safeRm(codebasePath, fastifyLogger)
}
```

### 9.4 错误码常量确认

沿用现有 `E_REPO_ALREADY_ATTACHED`（[`packages/shared/src/worktree.ts`](packages/shared/src/worktree.ts)）—— **不引入** 新错误码。半成品清理是 `clone()` 的内部细节，对外契约不变。

## 验收清单

- [ ] `safeRm` 失败时调用方能拿到 log warn（不只是静默吞错）
- [ ] `safeRm` 在 fd 竞争下 retry 3 次后仍失败 → 给「放弃」日志（可观测 > 静默）
- [ ] 新增 `isCompleteCodebase` 单元测试:覆盖 4 种状态(不存在 / 只有 .git 无 working tree / 完整仓库 / working tree 空)
- [ ] `clone()` 入口逻辑改完,新增测试 case:
  - 半成品残留(只有 `.git` 无 working tree)→ 重 clone 成功
  - 完整仓库 → E_REPO_ALREADY_ATTACHED 不变
  - 不存在路径 → 走正常 clone 路径
- [ ] 单元测试 + `repos-attach-clone.e2e.test.ts` 全 GREEN
- [ ] 手动复现:在 `<root>/requirements/<id>/codebase/foo/` 下手动 `git init .git` 后触发 attach foo → 应自动清理 + 重 clone

## 风险

- `isCompleteCodebase` 跑 `git ls-files` 是个 git 进程调用,会增加 ~50-100ms 启动开销(只在 `existsSync` 命中时跑,不影响干净路径)
- fd retry 100ms × 3 = 最多 300ms 延迟,在最坏情况下(checkout 失败后立即重试)会拉长用户感知,但比起永久残留坏状态是可接受的

## 依赖

- Issue 10(启动期 orphan 自愈)依赖本 issue 的 `isCompleteCodebase` 复用
- Issue 11(working tree 自检)依赖本 issue 的 safeRm retry 兜底

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q10 / C5](../decisions.md)
- Issue 03(`CodebaseManager` 初版)
- Issue 05(强制 env 注入)