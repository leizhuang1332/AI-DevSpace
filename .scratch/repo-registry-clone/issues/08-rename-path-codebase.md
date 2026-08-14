---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 03
Blocks: 无
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 08: 路径 `repos/` → `codebase/` 重命名 + 老形态不迁移

## 目标

把代码里所有 `requirements/<id>/repos/<name>/` 路径全部改为 `codebase/<name>/`；**老 worktree 形态目录保留在盘上不删**，但代码只认新路径。

## 子项

### 8.1 后端路径常量跟改

```bash
# 全仓 grep "requirements/.*repos/" —— 列出所有引用
grep -rn "requirements.*repos" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
```

预期要改的位置（基于 v1.0.6 调研）：
- `apps/agent/src/services/RequirementService.ts`：`deriveRepos()`（已用 fs 直读 `requirements/<id>/repos/`）
- `apps/agent/src/routes/requirement.ts`：调用 `deriveRepos()` 处
- `apps/web/src/lib/drafting.server.ts`：`readAttachedRepoNames()`（issue 06 同步）

修改：

```typescript
// 旧
function deriveRepos(reqDir: string): string[] {
  const reposDir = join(reqDir, 'repos')
  if (!existsSync(reposDir)) return []
  return readdirSync(reposDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
}

// 新（路径改 repos → codebase）
function deriveRepos(reqDir: string): string[] {
  const codebaseDir = join(reqDir, 'codebase')
  if (!existsSync(codebaseDir)) return []
  return readdirSync(codebaseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
}
```

### 8.2 删 `WorktreeManager.getWorktreePath` 等路径相关导出

```typescript
// 旧（WorktreeManager.ts 已被 issue 03 删除）
function getWorktreePath(reqId: string, repoName: string): string {
  return join(root, 'requirements', reqId, 'repos', repoName)
}
```

被 `CodebaseManager.getCodebasePath` 取代：

```typescript
// 新
function getCodebasePath(reqId: string, repoName: string): string {
  return join(root, 'requirements', reqId, 'codebase', repoName)
}
```

### 8.3 老形态目录不迁移（决策 Q11）

代码里**只读** `codebase/`，**不读** `repos/`。老需求下若 `repos/<name>/` 还有内容（worktree 形态），显示为「未关联」：

```typescript
// RequirementService.listRequirements()
async listRequirements(): Promise<RequirementSummary[]> {
  // ... 既有 ...
  return {
    ...req,
    repos: this.deriveRepos(reqDir),  // 仅读 codebase/
    // 不再读 repos/ 兼容老形态
  }
}
```

DRAFTING 弹层显示：

```typescript
// drafting-zone.tsx
const attachedRepos = data.selectedRepoNames  // 仅 codebase/ 派生
// 弹层标题：N=0 时「尚未关联任何仓库 — 从注册表选一个开始」
// 不再显示「检测到旧 worktree 目录，请重新关联」提示
```

**不主动** rm 老 `repos/<name>/` —— 让用户手动 `rm -rf ~/.aidevspace/requirements/<id>/repos/`。

### 8.4 启动时一次性清理（可选，本期不强制）

```typescript
// apps/agent/src/server.ts 启动路径（issue 04 的 initWorkspace 内可选）
// 不删，但日志提示
if (existsSync(join(reqDir, 'repos'))) {
  log.info(`detected legacy repos/ dir for ${reqId}, please manually delete after verifying no uncommitted work`)
}
```

### 8.5 测试

- `apps/agent/src/__tests__/requirement-derive-repos.test.ts`：tmp 需求下 `mkdir codebase/foo`、`mkdir repos/bar` → `deriveRepos` 只返 `['foo']`
- `apps/web/src/__tests__/drafting.server.test.ts`：老形态目录 `requirements/<id>/repos/<n>/` 存在 → SSR 不识别 → selectedRepoNames 返 `[]`
- 集成 e2e：模拟老用户升级路径——同时有 `codebase/foo` 和 `repos/bar` → 列表只显示 foo

## 验收清单

- [ ] 全仓 grep `requirements.*repos` 无业务路径引用（仅 issue 03/06 的历史引用被改）
- [ ] `deriveRepos` 路径常量改 `codebase`
- [ ] `getWorktreePath` 改 `getCodebasePath`（在 CodebaseManager 内）
- [ ] 老 `repos/` 目录**不删**；代码不识别
- [ ] 测试覆盖双形态共存场景

## 风险

- 用户在老 worktree 里**有未 push 的本地提交**——重新关联（走 clone 路径）会把老 worktree 留在盘上但 DRAFTING 显示未关联；用户必须手动 `git -C <worktree> push` 抢救。
  - **本期不做挽救**：决策 Q11 显式接受此代价；UI 提示「重新关联会丢失本地未提交改动，请先 push」是 P2 优化
- 任何遗漏的 `requirements/<id>/repos/` 引用都是**潜在 P0 bug**——务必全仓 grep + 测试

## 引用

- [PRD FR-3.1 / FR-6.3](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D4](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q11](../decisions.md)
