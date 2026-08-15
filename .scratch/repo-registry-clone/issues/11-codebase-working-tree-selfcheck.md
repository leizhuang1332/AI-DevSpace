---
Status: ready-for-agent
Type: task
Created: 2026-08-15
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 09, 10
Blocks: 无
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
Supersedes: 无
---

# Issue 11: clone 成功后 working tree 自检 + `reset --hard` 兜底

## 背景

即使 Issue 09 + 10 把入口侧和启动期清理修完,仍然存在一种边缘情况:**`.git` 完整 + working tree 被外部干扰清空**(用户手动 `rm`、spotlight 误删、文件系统损坏)。

这种状态下:
- `.git/HEAD` 仍指向有效 commit
- 但 `<codebase>/` 下没有任何 tracked 文件
- 现有 `clone()` 三步(git clone / checkout -b / rev-parse HEAD)都成功 —— **没有一道自检能发现 working tree 空**

本 issue 加一道**防御性兜底**:clone + checkout 都成功后,自检 working tree,如果空就 `git reset --hard HEAD` 强制恢复。

## 目标

在 `CodebaseManager.clone()` 走完 `checkout -b` 成功后,加一道 `git ls-files` 自检;working tree 为空时跑 `git reset --hard HEAD` 自愈。

## 子项

### 11.1 新增 `ensureWorkingTree()` 函数

[`apps/agent/src/codebase/CodebaseManager.ts`](apps/agent/src/codebase/CodebaseManager.ts) 加:

```typescript
/**
 * 确保 working tree 至少有 1 个 tracked 文件。
 * - 正常情况:git clone + checkout -b 之后 working tree 必有内容,no-op
 * - 边缘情况:working tree 被外部干扰清空(.git 完整但 <codebase>/ 空),
 *   跑 `git reset --hard HEAD` 强制恢复
 *
 * 不依赖 `isCompleteCodebase`(那是判定用,这里是修复用)。
 */
async function ensureWorkingTree(
  git: GitExec,
  codebasePath: string,
  logger?: SafeRmLogger,
): Promise<void> {
  const checkArgs = ['-C', toPosixPath(codebasePath), 'ls-files']
  const checkRes = await git(checkArgs)
  if (checkRes.code === 0 && checkRes.stdout.trim().length > 0) return
  // working tree 为空 → 强制 reset
  logger?.warn?.(
    { path: codebasePath },
    'clone: working tree empty after success, running reset --hard HEAD',
  )
  const resetRes = await git([
    '-C', toPosixPath(codebasePath),
    'reset', '--hard', 'HEAD',
  ])
  if (resetRes.code !== 0) {
    logger?.warn?.(
      { path: codebasePath, stderr: resetRes.stderr },
      'clone: reset --hard HEAD failed, leaving empty working tree',
    )
  }
}
```

### 11.2 `clone()` 集成自检

[`CodebaseManager.ts:295`](apps/agent/src/codebase/CodebaseManager.ts#L295) `return { ok: true, ... }` 之前插入:

```typescript
// 4. 自检 + 兜底:working tree 必须非空
await ensureWorkingTree(git, codebasePath, fastifyLogger)

return { ok: true, path: codebasePath, head, branch: branchName }
```

### 11.3 `logger` 注入链

- `CodebaseManagerDeps` 加 `logger?: SafeRmLogger`(可选,默认 no-op)
- `server.ts:292` `createCodebaseManager({...})` 注入 `logger: fastify.log`

## 验收清单

- [ ] `ensureWorkingTree` 单元测试:
  - working tree 有文件 → no-op(不调 reset)
  - working tree 空 → 调 reset --hard
  - reset 也失败 → log warn 但不抛
- [ ] `clone()` 集成后,新增 e2e 测试 case(可放在 `repos-attach-clone.e2e.test.ts`):
  ```typescript
  // 模拟:clone 成功后手动 rm working tree(只保留 .git)
  // → 触发 attach → 应自愈,working tree 恢复
  ```
- [ ] `createCodebaseManager` 默认 logger 是 no-op(向后兼容现有调用方)
- [ ] 现有 `repos-attach-clone.e2e.test.ts` 全 GREEN(自检对正常路径 no-op,不应破坏)
- [ ] 手动验证:
  ```bash
  # 正常 attach foo → 成功后
  rm -rf /tmp/ws/requirements/req-x/codebase/foo/*
  # 只保留 .git
  ls /tmp/ws/requirements/req-x/codebase/foo/  # 应只剩 .git
  # 重新 attach foo
  # → 应自愈:working tree 恢复(不是 E_REPO_ALREADY_ATTACHED)
  ```

## 风险

- `git reset --hard HEAD` 是**有破坏性**的命令:如果用户已经在 working tree 写了未提交改动,reset 会丢。
- 但本场景触发条件是「working tree 为空」,已经没有未提交改动可丢,所以 reset 是安全的。
- 性能:`git ls-files` 在大仓库(> 10k files)会慢 —— 但只在 self-check 跑一次,< 200ms 可接受

## 依赖

- 强依赖 Issue 09(`safeRm` retry + logger 注入链)
- 弱依赖 Issue 10(`isCompleteCodebase` 复用,虽然本 issue 用独立的 `ensureWorkingTree`)

## 不在范围

- 不处理 submodules(本期 codebase 不支持 submodules clone)
- 不处理 `.gitignore` 文件本身被 rm 的情况(后续 ADR 跟进)

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- Issue 09(`safeRm` 兜底)
- Issue 10(orphan 自愈)