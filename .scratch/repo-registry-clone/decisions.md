---
Status: ready-for-agent
Type: decisions
Created: 2026-08-14
Feature: repo-registry-clone
Source: `/grill-with-docs` Q1-Q15（2026-08-14）
---

# 决策账本 · 仓库注册表化 + 需求级独立 clone

> 本文件记录 15 项决策的完整账本。决策账本 ≠ PRD，PRD 描述「为什么 + 是什么」，账本记录「**选了什么、舍弃了什么、为什么**」。未来若有人翻旧账来质疑某项决策，回这里查。

---

## 用户拍板（12 项）

| # | 议题 | 决策 | 关键理由 |
|---|---|---|---|
| Q1 | 放弃 worktree 的动因 | **可移植配置 + 简化心智模型**（*不是*磁盘、*不是* worktree 有故障） | 用户明示选择这两个动因；不混 |
| Q2 | 注册表 yaml 落点 | `~/.aidevspace/repos.yaml` 独立单文件 | 拷一个文件就能搬窝；与含本机设置的 `config.yaml` 职责分离 |
| Q3 | 旧 `~/.aidevspace/repos/` 目录 | 启动时一次性自动迁移进 yaml，**不删**源码 | 旧目录可能含未 push 提交；安全为先 |
| Q4 | 身份模型 | **`name` 唯一即标识，`repo-` 前缀和 `id` 字段彻底删除** | 用户明示「不需要 id 了，都改为用 name 关联」 |
| Q5 | 添加仓库校验 | 写 yaml 前跑 `git ls-remote --heads` 验证 | 错误 URL 当场暴露，不藏到 clone 时炸 |
| Q6 | `/repos` 页面卡片 | 名称 + gitUrl + 描述 + **被 N 个需求使用** | 唯一可派生的「活」信号保留 |
| Q7 | 删除 / 编辑 | **做**。删除只摧 yaml 条目；被 N≥1 需求使用时二次确认 | 弥补原 PRD 未提的洞 |
| Q8 | clone 耗时处理 | **202 Accepted + SSE 进度推送**，并行 clone | 既有 `requirementEventsRoute` 基础设施现成 |
| Q9 | git 凭据 | **完全依赖宿主机**（SSH agent / credential helper），零密钥落盘 | 符合本地优先架构 + 零密钥落盘风险 |
| Q10 | 幂等 / 清理 | 目录已存在 → `E_REPO_ALREADY_ATTACHED`；clone 失败 → `rm -rf` 半成品 | 「要么完整要么不存在」二选一 |
| Q11 | 旧 `requirements/*/repos/`（worktree 形态）| **不迁移**，代码只认 `codebase/` | worktree 形态一次性出局；不混两种物理形态 |
| Q12 | 术语 | **RepoRegistry**（弃用「仓库池」）+ **Codebase**（弃用 worktree）| 池里没源码了，「池」名不副实 |
| Q13 | clone 中状态 | 落盘 `codebase/.pending-<name>` 标记；agent 启动时扫残留清理半成品 | 一个机制同时解决 F5 续看 + agent 重启失忆 |
| Q14 | 弹层 Git URL 入口 | 不做添加，改为「去仓库页添加 →」跳转引导 | 兑现 ADR-0016 D7 欠账；用户原话限定「此页面」（指 `/repos`）的添加 |
| Q15 | ADR 形状 | 单份 **ADR-0030**，supersede ADR-0003 全文 + ADR-0016 D1/D3/D5 | 三变更是一整体决策，拆开会看不懂因果 |

---

## 我替你定的（6 项，可推翻）

| # | 议题 | 决策 | 备注 |
|---|---|---|---|
| C1 | yaml 字段 | **不加** `defaultBranch` | base 分支用 clone 下来的 remote HEAD，比原 `show-ref` 探测 main→master 更准 |
| C2 | 查询实现 | **纯客户端过滤**，匹配三字段；placeholder 去「分支」 | 仓库数 <100，加后端 query 是过度设计 |
| C3 | 类名 | `WorktreeManager` **删除**，新建 `CodebaseManager`（`clone` / `remove` / `list`） | 类名要反映新语义 |
| C4 | 错误码 | 删 `E_BASE_BRANCH_NOT_FOUND` / `E_BRANCH_EXISTS`；改 `E_REPO_NOT_FOUND` 语义；新增 `E_REPO_ALREADY_ATTACHED` / `E_REPO_NAME_EXISTS` | 详见 ADR-0030 D5 |
| C5 | git exec env | `createDefaultGitExec()` 强制注入 `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=""` / `SSH_ASKPASS=""` | 否则缺凭据时 git 会**交互挂死后台进程** |
| C6 | ticket 落点 | `.scratch/repo-registry-clone/` | 沿用 feature-per-directory 约定 |

---

## 边界风险（3 项，记账）

| # | 议题 | 代价 | 缓解 |
|---|---|---|---|
| R1 | 磁盘 n 倍 | 10 需求 × 5 仓库 = 50 份完整 clone。**这正是 ADR-0003 当年否决此方案的核心理由** | `/repos` 页面首次大量关联时显式提示「将消耗约 X GB」 |
| R2 | 首次关联从秒级变分钟级 | 本地 worktree → 网络 clone | SSE 进度让等待可见，**不**让等待变快；用户显式接受 |
| R3 | 老需求重新关联丢历史 | 老 worktree 里的本地未 push 提交随重关联消失 | 老形态目录保留在盘上，迁移前手动备份即可 |

---

## 反向引用（决策被推翻时回查）

- [ADR-0003](../docs/adr/0003-git-worktree-isolation.md) 当年 Alternatives Considered 第一条「每个需求独立 clone」被否决的理由（磁盘 n 倍）现在被本期显式接受
- [ADR-0016 D1](../docs/adr/0016-attach-repos-real-pool.md) 当年 Alternatives Considered 的「配置清单 B（读 `~/.aidevspace/repos.yaml`）」被否决的理由（双写漂移 + 决策 24 反对让用户编辑配置）现在被本期**显式推翻**——因为仓库池里没有源码了，「目录即真相」本身不成立；可移植配置诉求压过决策 24

---

## 已知未解（不阻塞本期，但留给未来 ADR）

1. **yaml 字段扩展**（默认分支 / 语言 / 克隆大小 / 最后 fetch）→ P2 单独 ADR
2. **clone 加速**（shallow / 裸镜像 / `--reference`）→ P2 单独 ADR，需重启成本收益评估
3. **多 workspace 共享注册表**（用户层 dotfiles / 团队内分发机制）→ P2 单独 ADR
4. **yaml schema 版本演进**（当前 `version: 1`，未来 `version: 2` 时的迁移策略）→ 触发时再写
5. **clone 失败时的诊断信息**（stderr / 日志路径 / 错误码粒度）→ 当前仅 `E_AUTH / E_NETWORK / E_DISK_FULL / E_INTERNAL` 4 桶；可能需要更细分
