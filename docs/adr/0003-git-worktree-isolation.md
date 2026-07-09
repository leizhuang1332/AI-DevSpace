# ADR-0003: 仓库全局共享 + git worktree 多需求隔离

**Status:** Accepted  
**Date:** 2026-07-08

## Context

用户后端是微服务架构，一个需求可能涉及多个仓库。痛点：
- 同一仓库被多个需求同时改会冲突
- 每个需求都 `git clone` 一次浪费空间

## Decision

**全局仓库池 + git worktree 隔离**。

- 全局位置：`~/.aidevspace/repos/<repo-name>/`（主仓库）
- 需求下：`~/.aidevspace/requirements/<req-id>/repos/<repo-name>/`（worktree 形式）
- 每个需求创建时，对每个关联 repo 在需求下建 worktree（独立 branch）
- 需求完成时合并回主分支（用户授权后）

## Consequences

### 正面
- 仓库只 clone 一次，节省磁盘与网络
- 多需求可并发改同一仓库不同 branch，零冲突
- worktree 之间共享 `.git` 目录，操作快
- IDEA 打开时直接打开 worktree 路径，体验自然

### 负面
- worktree 不能跨设备（每台机器自己 worktree）
- 删除 worktree 需谨慎（不要误删主仓库）
- Agent 需要管理 worktree 生命周期（创建 / 清理 / 切换 branch）

### 缓解措施
- Agent 提供"清理孤儿 worktree"功能
- meta.yaml 记录 worktree 路径与 branch 名，便于回溯

## Alternatives Considered

- **每个需求独立 clone**：浪费空间，n 个需求 = n 倍磁盘
- **共享文件系统，文件级锁**：粒度太粗，体验差
