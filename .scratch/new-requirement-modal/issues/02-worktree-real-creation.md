---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 02 — Worktree 真实创建(后端 git 操作)

**What to build:**

在 ticket 01 的"关联仓库"弹层提交后,Agent 端给每个勾选的 repo 基于默认 base 分支(`main`,可在仓库级配置覆盖)拉**统一分支名**,worktree 落到 `~/.aidevspace/requirements/<req-id>/repos/<repo-name>/`。

**Blocked by:** 01 (前端弹层) + 04 (后端 API + 目录结构)

> 注:01 和 04 都从 None 开始可并行先做;本 ticket 在两者完成后才能开工。

**Status:** ready-for-agent

- [ ] 首次关联 N 个 repo,Agent 给每个 repo 在 `~/.aidevspace/repos/<repo-name>/` 基础上执行 `git worktree add -b <统一分支名> <requirements/<req-id>/repos/<repo-name>/> main`,3 个 repo 全部成功
- [ ] 追加第 N+1 个 repo 时,沿用首条统一分支名(不重新让用户填)
- [ ] 每个 repo 的 worktree 路径独立,不互相覆盖
- [ ] base 分支不在时(`main` 不存在,repo 实际是 `master`):Agent 自动 fallback 到 `master`;`main`/`master` 都不存在 → 报 `E_BASE_BRANCH_NOT_FOUND` 红色 banner
- [ ] 鉴权失败(token 过期 / Origin 校验失败,决策 34)→ 报 `E_AUTH` 红色 banner `[查看]` 按钮跳设置页
- [ ] 磁盘空间不足 → 报 `E_DISK_FULL` 红色 banner `[查看日志]` 按钮
- [ ] 网络错 → 报 `E_NETWORK` 红色 banner `[重试]` 按钮,3 次后停止重试(决策 30)
- [ ] 部分 repo 失败:N=3 中 1 个失败 → 已成功的保留,失败的标红,资源树显示 `2 已关联 · 1 失败 · [重试该 repo]`
- [ ] worktree 创建成功后,资源树对应 repo 节点显示 `🟢 <repo-name> <branch>`(绿色小圆点 = 已创建)
- [ ] 提交时若分支名包含路径非法字符,Agent 端再校验一次(前端已过滤,后端兜底)→ 报 `E_INVALID_BRANCH_NAME`
- [ ] 单元测试覆盖:成功路径 / 单 repo 失败 / 多 repo 部分失败 / 重试 3 次上限
- [ ] e2e 测试:ticket 01 弹层提交后,真实文件系统 worktree 目录被创建
