---
Status: ready-for-agent
Type: task
Created: 2026-08-15
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 09
Blocks: 11
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
Supersedes: 无
---

# Issue 10: 启动期扫 orphan `.git-only` codebase + 自愈

## 背景

[`server.ts:305`](apps/agent/src/server.ts#L305) 的 `scanOrphanedPending()` 只清**带 `.pending-<name>` 标记**的半成品目录。但 `RequirementService.attachRepo` 在 clone 完成后（无论成败）都会调 `clearPending()`（[`RequirementService.ts:325`](apps/agent/src/services/RequirementService.ts#L325)）—— 所以**孤儿 `.git-only` 目录不会有 `.pending-` 标记**，启动清理扫不到。

**用户实测 bug**：attach 失败后残留 `codebase/multica/.git`，再次 attach 时 [`CodebaseManager.ts:218`](apps/agent/src/codebase/CodebaseManager.ts#L218) 走 `E_REPO_ALREADY_ATTACHED` 短路（Issue 09 解决入口侧），但**已经处于坏状态的旧数据**仍然存在盘上 —— 启动时必须清理，否则用户即使重 attach 也看不到文件。

本 issue 与 Issue 09 并行:09 修「入口拦截」,10 修「启动期清理已有残留」。

## 目标

新增 `scanOrphanedCodebases()` 扫所有「只有 `.git` 没有 working tree」的目录,启动期统一清掉。

## 子项

### 10.1 新增 `scanOrphanedCodebases()`

[`apps/agent/src/codebase/CodebaseManager.ts`](apps/agent/src/codebase/CodebaseManager.ts) 加:

```typescript
/**
 * 扫所有「.git 存在但 working tree 为空」的 codebase 目录。
 * 与 `scanOrphanedPending` 的区别:
 * - scanOrphanedPending 只清带 `.pending-<name>` 标记的目录
 *   (clone 异常退出留下的真正半成品)
 * - scanOrphanedCodebases 清「.git 残留但 working tree 空」的目录
 *   (上次 attach checkout 失败 + safeRm 漏过后留下的孤儿)
 *
 * 启动钩子会 rm -rf 每个 entry + 记 warn log,让用户能据此排查。
 */
async function scanOrphanedCodebases(): Promise<OrphanedCodebaseEntry[]> {
  const out: OrphanedCodebaseEntry[] = []
  const reqDir = join(root, 'requirements')
  if (!existsSync(reqDir)) return out
  let reqEntries: string[]
  try {
    reqEntries = readdirSync(reqDir)
  } catch {
    return out
  }
  for (const reqId of reqEntries) {
    if (!reqId.startsWith('req-')) continue
    const codebaseDir = join(reqDir, reqId, 'codebase')
    if (!existsSync(codebaseDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(codebaseDir)
    } catch {
      continue
    }
    for (const name of entries) {
      // 跳过半成品标记(由 scanOrphanedPending 处理)和隐藏文件
      if (name.startsWith('.')) continue
      const path = join(codebaseDir, name)
      try {
        const st = statSync(path)
        if (!st.isDirectory()) continue
      } catch {
        continue
      }
      // 用 isCompleteCodebase 判定:不完整就是孤儿
      // 复用 Issue 09 提供的判定函数
      const complete = await isCompleteCodebase(git, path)
      if (!complete) {
        out.push({ reqId, repoName: name, path })
      }
    }
  }
  return out
}

export interface OrphanedCodebaseEntry {
  reqId: string
  repoName: string
  path: string
}
```

并在 `CodebaseManager` 接口加 `scanOrphanedCodebases`。

### 10.2 启动钩子集成

[`server.ts:305`](apps/agent/src/server.ts#L305) 的现有 orphan pending 清理后追加:

```typescript
// issue 10:同时清孤儿 .git-only 目录(残留半成品,带 .git 但无 working tree)
try {
  const orphanCodebases = await codebaseMgr.scanOrphanedCodebases()
  for (const { reqId, repoName, path } of orphanCodebases) {
    fastify.log.warn(
      { reqId, repoName, path },
      'codebase: cleaning orphaned .git-only directory on boot',
    )
    await codebaseMgr.remove(reqId, repoName)
  }
  if (orphanCodebases.length > 0) {
    fastify.log.info(
      { count: orphanCodebases.length },
      'codebase: orphan .git-only directory cleaned on boot',
    )
  }
} catch (err) {
  fastify.log.error(
    { err },
    'codebase: orphan .git-only cleanup failed on boot',
  )
}
```

注意:
- 启动期清理失败不应阻断 agent 启动,仅日志告警(与 orphan pending 同策略)
- 调用顺序:先 `scanOrphanedPending` 再 `scanOrphanedCodebases` —— 因为前者清理更严重的「半成品」,后者只清「半完整」

### 10.3 复用 Issue 09 的 `isCompleteCodebase`

`scanOrphanedCodebases` 直接 import `isCompleteCodebase`(Issue 09.2 实现)。

## 验收清单

- [ ] 新增 `scanOrphanedCodebases()` 单元测试:
  - 空 requirements 目录 → `[]`
  - 完整仓库 → 不出现在结果中
  - 只有 `.git` 无 working tree → 出现
  - working tree 空(HEAD 指向空 commit)→ 出现(由 Issue 11 兜底修)
  - `.pending-<name>` 标记目录 → 不出现(由 `scanOrphanedPending` 处理)
- [ ] 启动钩子先清 orphan pending 再清 orphan codebases,顺序固定
- [ ] 启动期清理失败仅日志,不阻断 agent 启动
- [ ] `server.ts` boot 路径集成完整,fastify.log 输出格式与现有 `codebase:` 前缀一致
- [ ] 手动验证:
  ```bash
  # 制造孤儿:在 codebase/foo/ 下手动 git init + 立刻 rm working tree
  mkdir -p /tmp/ws/requirements/req-x/codebase/foo
  git init -q /tmp/ws/requirements/req-x/codebase/foo/.git
  # 重启 agent → 启动日志应出现「codebase: cleaning orphaned .git-only directory」
  # 目录应被删
  ```

## 风险

- requirements 数大(> 1000)时,扫所有 codebase 目录跑 `git ls-files` 会慢 —— 但本期沿用「简单全扫」策略(Issue 03 风险章节已显式接受),优化推迟到后续
- 启动期增加 IO:每个孤儿候选跑一次 `git ls-files`,通常 < 50ms;100 个孤儿约 5s 启动延迟 —— 用户首次启动可接受

## 依赖

- 强依赖 Issue 09(复用 `isCompleteCodebase` 实现)
- 与 Issue 09 并行落地,同 sprint

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- Issue 03(`scanOrphanedPending` 初版)
- Issue 09(`isCompleteCodebase` 实现)