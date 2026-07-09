---
Status: ready-for-agent
Type: task
Stage: 2
---

# 06 - 仓库管理与 Git Worktree 自动化

## 目标

落地 ADR-0003：全局仓库池 + 每需求 worktree 隔离。

## 范围

- [ ] Agent 端 `RepositoryService`：
  - `addRemote(url, name)`：clone 到 `~/.aidevspace/repos/<name>/`
  - `list()`：列出全局仓库
  - `remove(name)`：删除仓库
  - `createWorktree(repoName, requirementId, branchName)`：在 `requirements/<id>/repos/<repoName>/` 建 worktree
  - `removeWorktree(...)`：清理 worktree
  - `listWorktrees(requirementId)`
  - `getStatus(requirementId, repoName)`：返回 branch、latest commit、changed files
  - `getDiff(requirementId, repoName, fromRef, toRef)`
  - `commit(requirementId, repoName, message)`
  - `push(requirementId, repoName)`：用户授权后
- [ ] Web 端 `/repos` 列表页 + 新增仓库 Dialog（URL 输入 + 凭证）
- [ ] Web 端需求详情页 → 仓库 Tab：列出关联 worktree，每个 worktree 卡片显示 branch / 最新 commit / 变更文件数
- [ ] Web 端"用 IDEA 打开"按钮（`platform === 'darwin' ? 'open -a' : 'start ""'` 跨平台协议）

## 验收

- 能从 URL 克隆仓库到全局池
- 创建一个需求并关联 2 个 repo，自动生成 2 个 worktree
- 两个需求关联同一 repo 时，branch 互不冲突
- 详情页能展示每个 worktree 的最新 commit 和变更文件
- "用 IDEA 打开"按钮在 macOS / Windows 上都能唤起

## 依赖

- [05-requirement-crud.md](05-requirement-crud.md)
