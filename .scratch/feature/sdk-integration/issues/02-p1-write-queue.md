---
Status: needs-triage
Type: task
Stage: P1
---

# 02 - P1 写队列：WorktreeManager + WriteQueue FIFO（Q4 核心）

## 目标

落地 ADR-0010 Q4：共享 req worktree + per-req 写操作 FIFO 队列，**不引入 per-session worktree**。

## 范围

- [ ] `worktree/WorktreeManager.ts` — 复用 [ADR-0003](../../docs/adr/0003-git-worktree-isolation.md) 的 pool + worktree 模型
  - `createWorktree(reqId, repoName, branchName)` — `git worktree add <req-dir>/repos/<repo> -b <branch> master`
  - `removeWorktree(reqId, repoName)` — `git worktree remove`
  - `listWorktrees()` / `getWorktreePath(reqId, repoName)`
- [ ] `worktree/WriteQueue.ts` — per-req FIFO 写操作串行
  ```ts
  const writeQueues = new Map<reqId, Promise<void>>()
  async function execWriteTool(reqId, toolCall) {
    const prev = writeQueues.get(reqId) ?? Promise.resolve()
    const next = prev.then(() => doToolCall(toolCall))
    writeQueues.set(reqId, next.catch(() => {}))
    return next
  }
  ```
- [ ] 工具分类（写 vs 读）：
  - **写**：`Edit` / `Write` / `NotebookEdit` / `Bash`（含 `rm` / `mv` / `cp` / `>` / `git commit` / `git push` 等）
  - **读**：`Read` / `Grep` / `Glob` / `Bash`（纯读命令如 `ls` / `cat` / `git status` / `git log`）
- [ ] 一个最小的工具执行器（不依赖 SDK 的 PreToolUse hook，先用 Agent 侧分类）：
  - 写类 → 走 WriteQueue
  - 读类 → 直接执行
  - Bash 命令内容正则判断写/读（保守策略：含 `rm` / `>` / `git commit` / `git push` / `mv` / `cp` / `chmod` 都算写）
- [ ] 错误处理：写操作失败不卡队列（`.catch(() => {})`）

## 验收

- 同一 req 起 2 个 session，都发「写文件 X.java」的 query
- 第一个 session 的 Edit 工具调用执行完，第二个才执行
- 不出现「两个 Edit 同一文件」导致的文件内容丢失
- 读类工具调用（Read / Grep）不受队列影响，可并行
- 不同 req 的写操作互不干扰（per-req 独立队列）

## 依赖

- [01-p0-skeleton.md](01-p0-skeleton.md)
- [Issue 06-repo-worktree.md](../../ai-devspace-mvp/issues/06-repo-worktree.md)（worktree 管理已部分实现）

## 估时

0.5 周

## 备注

- P1 阶段**先用 Agent 侧分类**，SDK 原生 `PreToolUse` hook 留给 P2 阶段（Q6 高危检测）
- P1 只解决「写不冲突」，不解决「高危操作拦截」（Q6）
