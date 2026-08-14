---
Status: ready-for-agent
Type: prd
Created: 2026-08-14
Feature: repo-registry-clone
Supersedes: 无(全新架构变更)
Implements: CONTEXT.md 决策 104-118(v1.0.7)
Implements ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
Superseded ADR: docs/adr/0003-git-worktree-isolation.md(全文) / docs/adr/0016-attach-repos-real-pool.md(D1/D3/D5)
Related:
  - .scratch/zone-data-fidelity-fixes/PRD.md(DRAFTING 工位 fs 直读链路)
  - .scratch/new-requirement-modal/issues/06-attach-repos-real-pool.md(上一期 read 侧接入)
  - docs/agents/issue-tracker.md(feature-per-directory 约定)
  - docs/agents/domain.md(CONTEXT.md / ADR)
---

# 仓库注册表化 + 需求级独立 clone · PRD v1.0.7

> 本 PRD 是 v1.0.7 架构回退的落地文档。推翻 [ADR-0003](../docs/adr/0003-git-worktree-isolation.md) 全文（仓库全局共享 + git worktree 隔离）和 [ADR-0016](../docs/adr/0016-attach-repos-real-pool.md) 的 D1/D3/D5（物理目录真相源），将仓库池从「物理目录扫子仓库」改为「yaml 文件注册表」，需求下的关联从「worktree」改为「独立 clone」，关联路径从 `requirements/<id>/repos/<name>/` 重命名为 `requirements/<id>/codebase/<name>/`。
>
> 取代动因（用户 2026-08-14 `/grill-with-docs` 拍板）：**配置可移植 + 简化心智模型**。代价显式接受：**磁盘 n 倍 + 首次关联从秒级变分钟级**（这正是 ADR-0003 当年否决此方案的核心理由，本期以「可移植配置诉求压倒磁盘成本」名义**显式接受**）。

---

## 1. Problem Statement

v1.0 → v1.0.6 三套核心决策锁定了「全局仓库池 + git worktree」架构：

| 决策 | 内容 | 当下的问题 |
|---|---|---|
| [ADR-0003](../docs/adr/0003-git-worktree-isolation.md) | 池仓库 `~/.aidevspace/repos/<name>/` 物理存盘 + 需求下 `git worktree add` 出独立分支 | worktree 跨设备失效（依赖中心池的 `.git/worktrees` 注册）；AI / IDE 行为有边角问题 |
| [ADR-0016 D1](../docs/adr/0016-attach-repos-real-pool.md) | 真相源 = `<root>/repos/` 物理目录 readdir | 配置**不可移植**：用户想把「我在用哪些仓库」提交进 git、分发给同事、搬到另一台机器——目录做不到 |
| 决策 24 | AI 陪伴哲学「克制，在场」 | 「让用户编辑配置文件」被 [ADR-0016 D1](../docs/adr/0016-attach-repos-real-pool.md) 显式否决，但用户实际诉求（可移植）压过了这条顾虑 |

**结果**：架构与用户诉求冲突。

---

## 2. User Story

### US-1（用户 A 跨设备搬窝）

> 我开发用两台电脑，希望把「我用哪些仓库」同步过去。现在我得在每台机器上 `mkdir` + `cd` + `git clone` 一遍，太蠢。

**现在**：每个仓库都是 `~/.aidevspace/repos/<name>/` 下的一坨 `.git` + 工作区，不能像配置文件那样 `git add` / `scp` / `cp` / 分享。

**期望**：仓库信息在单个 yaml 文件里，我 `cp` 给同事 / 同步到 dotfiles 仓库 / 提交进工作流——对方进入 `/repos` 立即看到全部。

### US-2（用户 B 心智简化）

> 我让新人加入项目时，最难解释的就是「worktree 不是分支也不是 clone，是 git 高级概念」——结果他每次操作前都要问「这个 worktree 在另一台机器上有吗」「为啥我 push 一次主仓库也变了」。

**期望**：每个需求下是一份**自包含**的 clone。跨设备行为一致、AI 操作可预期、VSCode 打开直接当普通 git 仓库。

### US-3（用户 C 误删保护）

> 我想换掉某个仓库的 git URL。我担心 agent 会顺手把所有人已经 clone 到需求下的源码也一起删了。

**期望**：改 yaml 条目 / 删 yaml 条目——**只动注册表**，已 clone 的 `requirements/<id>/codebase/<name>/` 绝不被触碰。

### US-4（用户 D 离线体验）

> 我在高铁上点关联仓库，进度条转圈 30 秒后告诉我网络断了——我刷新页面，刚才的进度信息全没了，我不知道哪些仓库其实已经在 clone 了。

**期望**：状态落盘，F5 后能看到「⏳ 退款服务 还在 clone」「🟢 订单服务 已就绪」。网络恢复点重试就干净。

### US-5（用户 E 凭据管理）

> 我不想让 AI 工具存我的 GitHub token。我已经配好了 SSH key，凭啥还得在 AI 设置里再填一遍。

**期望**：agent 直接用宿主机 git 凭据（SSH agent / credential helper）。完全不在本机落任何密钥。

---

## 3. Functional Requirements

### FR-1 注册表读写

| ID | 要求 | 验收 |
|---|---|---|
| FR-1.1 | `~/.aidevspace/repos.yaml` 是仓库注册表的唯一真相源 | 文件不存在 / 无 `repos` 字段都视为空注册表 |
| FR-1.2 | 字段最小集 `{name, gitUrl, description}` 三字段；顶层 `version: 1` 用于未来 schema 演进 | Zod schema 校验；多余字段不报错但忽略 |
| FR-1.3 | `name` 全局唯一即标识；删除既有 `repo-<name>` slug 派生 | 重复 name 写入 → `E_REPO_NAME_EXISTS` |
| FR-1.4 | yaml 原子写入；并发场景用 200ms 退避的轻量重试覆盖 | 集成测试：两路并发写 100 次不丢字段 |

### FR-2 API 端点

| 端点 | 方法 | 行为 |
|---|---|---|
| `/api/repos` | GET | 读 `repos.yaml` → `{repos: [{name, gitUrl, description}]}`；空 / 不存在 → 200 `{repos: []}` |
| `/api/repos` | POST | 入参 `{name, gitUrl, description}`；先 `git ls-remote --heads <gitUrl>` 验证；通过才写 yaml；重复 name → `E_REPO_NAME_EXISTS`；验证超时 / 失败 → `E_AUTH` 或 `E_NETWORK` |
| `/api/repos/:name` | PUT | 改 yaml 对应条目；**不**碰已 clone 的 codebase |
| `/api/repos/:name` | DELETE | 从 yaml 移除；**不** rm 任何 `codebase/<name>/`；被 N≥1 需求使用时二次确认告知影响 |

### FR-3 需求关联 = 独立 clone

| ID | 要求 | 验收 |
|---|---|---|
| FR-3.1 | 路径 `requirements/<req-id>/codebase/<repo-name>/` | fs 集成测试断言 |
| FR-3.2 | 命令：`git clone <gitUrl> <codebasePath>` + `cd <codebasePath> && git checkout -b <branch>`（base = remote HEAD） | e2e 真实 git 跑通 |
| FR-3.3 | POST `/api/requirement/:id/repos` 立即返 202；并行 clone 多个仓库 | 集成测试：POST 50ms 内返 202 |
| FR-3.4 | 通过既有 `requirementEventsRoute` SSE 推 `repo-clone-progress` 事件（`pending` → `cloning` → `ready` / `failed`） | e2e：订阅 SSE 收齐 5 个 repo 的完整生命周期事件 |
| FR-3.5 | clone 前写 `codebase/.pending-<name>`，成功 / 失败都删 | 集成测试断言文件系统 |
| FR-3.6 | 目录已存在 → 立即返 `E_REPO_ALREADY_ATTACHED`，不重 clone | 集成测试 |
| FR-3.7 | clone 中途失败 → `rm -rf` 半成品目录 | 集成测试：模拟网络断 → 目录被清空 + pending 标记被清 |
| FR-3.8 | 任一成功 → 把 `branchName` 写入 `meta.yaml`（保留 SSR 持久化契约） | 集成测试断言 `meta.yaml` |
| FR-3.9 | git 凭据完全依赖宿主机：`createDefaultGitExec()` 强制 `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=""` / `SSH_ASKPASS=""` | 单元测试：env 注入；集成测试：无凭据时 git 不挂死 |

### FR-4 `/repos` 页面

| ID | 要求 | 验收 |
|---|---|---|
| FR-4.1 | 卡片渲染 `{name, gitUrl, description, 关联需求数}` 四字段 | UI 测试 |
| FR-4.2 | 「被 N 个需求使用」实时派生：扫 `requirements/*/codebase/<name>/` 子目录 | UI 测试：关联 / 解除关联后数字立即变 |
| FR-4.3 | 列表页顶部文案「N 个仓库 · M 个 worktree」→「N 个仓库」 | UI 测试 |
| FR-4.4 | 详情页 `/repos/[name]` 从「worktree 列表」改为「关联需求列表 + 分支名 + 本地路径」 | UI 测试 |
| FR-4.5 | 搜索框 placeholder 改「仓库名 / 地址 / 描述…」；客户端过滤三字段 | UI 测试 |
| FR-4.6 | hover 卡片出「编辑 / 删除」按钮；删除二次确认（被 N≥1 需求使用时） | UI 测试 |

### FR-5 DRAFTING 弹层

| ID | 要求 | 验收 |
|---|---|---|
| FR-5.1 | "+ 添加新仓库（粘贴 Git URL）" 入口**删除**；改为「没找到？去仓库页添加 →」跳转 `/repos` | UI 测试 |
| FR-5.2 | 兑现 [ADR-0016 D7](../docs/adr/0016-attach-repos-real-pool.md) 留的「POST 端点接入即取消禁用」欠账 | UI 测试 |

### FR-6 一次性迁移

| ID | 要求 | 验收 |
|---|---|---|
| FR-6.1 | 启动时若 `~/.aidevspace/repos/` 仍有子仓库 → 读各 `git remote get-url origin` 生成 `repos.yaml` 条目（description 留空） | 集成测试：迁移前/后数据对比 |
| FR-6.2 | **不删**旧目录；启动日志 + UI 提示「旧目录可手动删除」 | UI 测试 |
| FR-6.3 | `WorkspaceService.SUBDIRS` 移除 `'repos'` | 单测 |

---

## 4. Non-Functional Requirements

| ID | 要求 |
|---|---|
| NFR-1 | 整体架构回退由 ADR-0030 单一文档承载；旧 ADR-0003 / ADR-0016 加 `Status: superseded by ADR-0030` 标记（issue 01 已落） |
| NFR-2 | 契约破坏性变更波及 `RepoPoolEntry` → `RepoRegistryEntry` / `repoIds` → `repoNames` / `worktreePath` → `codebasePath` —— 上下游跟改（见 issue 06） |
| NFR-3 | `selectedRepoIds` 是 fs 实时派生的、`meta.yaml` 只存 `branchName`——**无存量脏数据要迁移** |
| NFR-4 | workspace `.gitignore` 必补 `requirements/*/codebase/` + `*/codebase/**/.git/`——避免嵌套 git 仓库污染 workspace 自身版本管理（issue 04） |
| NFR-5 | 错误码调整遵循 ADR-0030 D5（删 `E_BASE_BRANCH_NOT_FOUND` / `E_BRANCH_EXISTS`；改 `E_REPO_NOT_FOUND` 语义；新增 `E_REPO_ALREADY_ATTACHED` / `E_REPO_NAME_EXISTS`） |

---

## 5. Out of Scope（明确剔除）

- shallow clone 加速（`--depth 1` 会限制 rebase / AI 历史分析）
- 裸镜像 / `--reference` 共享 objects（违背「简化心智模型」决策）
- yaml 字段加密 / 凭据回写（凭据完全依赖宿主机，yaml 不落任何密钥）
- 跨 workspace 共享注册表（本期单 workspace 持有 yaml）
- 元数据扩展（默认分支 / 语言 / 克隆大小 / 最后 fetch）
- 老 `requirements/*/repos/` worktree 形态的迁移（不兼容双形态共存）
- `/repos` 页面的批量操作（多选 + 批量删除）

---

## 6. 决策账本指针

完整 15 项决策（含用户拍板的 12 项 + 我替你定的 6 项 + 边界风险 3 项）见 [`decisions.md`](decisions.md)。

---

## 7. 实施分解（8 子项）

| # | issue | 主题 |
|---|---|---|
| 01 | [`issues/01-shared-schema.md`](issues/01-shared-schema.md) | shared 包 schema 改造 + ADR 落档 |
| 02 | [`issues/02-repos-route-crud.md`](issues/02-repos-route-crud.md) | `routes/repos.ts` 重写 + GET/POST/PUT/DELETE |
| 03 | [`issues/03-codebase-manager.md`](issues/03-codebase-manager.md) | `CodebaseManager` 替换 `WorktreeManager` + 异步 attach |
| 04 | [`issues/04-workspace-yaml.md`](issues/04-workspace-yaml.md) | `WorkspaceService` 改 yaml 真相源 + 一次性迁移 + `.gitignore` 补齐 |
| 05 | [`issues/05-git-exec-env.md`](issues/05-git-exec-env.md) | `createDefaultGitExec()` 强制 env 注入 |
| 06 | [`issues/06-web-frontend-followup.md`](issues/06-web-frontend-followup.md) | web 端契约跟改 + DRAFTING 弹层收尾 |
| 07 | [`issues/07-repos-page-redesign.md`](issues/07-repos-page-redesign.md) | `/repos` 列表 + 详情页重写 + mock 退场 |
| 08 | [`issues/08-rename-path-codebase.md`](issues/08-rename-path-codebase.md) | 路径 `repos/` → `codebase/` 重命名 + 老形态不迁移 |

**子项间无强顺序**：01（schema）必须先；02/03/04/05 是底层管道可并行；06/07/08 等底层落地后并行做。集成 e2e 在全部 8 项完成后单跑。

---

## 8. 验证（端到端）

| 场景 | 期望 |
|---|---|
| 1 | A 写 `repos.yaml`（3 条）→ `cp` 给 B（同名 workspace）→ 进 `/repos` 立即看到 3 条；B 进 DRAFTING 弹层能看到同样 3 条；点关联触发 clone |
| 2 | A 在 `/repos` 点「+ 添加仓库」→ 填 `name=foo` / `gitUrl=git@github.com:foo/bar.git` / `description=...` → 跑 `ls-remote` 通过 → 写入 yaml → 卡片出现 |
| 3 | A 在 `/repos` 点「+ 添加仓库」填错的 URL → `ls-remote` 报 `E_NETWORK` → 红 banner「URL 不可达 / 凭据不可用」→ 不写 yaml |
| 4 | A 进 DRAFTING → 选 2 个 repo → 填分支名 `feat/foo` → 提交 → 立即看到 `⏳ 退款服务` + `⏳ 订单服务` 两个 chip + 弹层关闭 → SSE 推 `cloning` → 推 `ready`（或 `failed`） |
| 5 | A 在 clone 进行中按 F5 → 进 DRAFTING 仍看到两个 chip 显示 `⏳ 克隆中`；agent 被 kill → 重启后扫到 `.pending-` → 清掉半成品 → F5 进 DRAFTING 显示「未关联」 |
| 6 | A 在 `/repos` 点删除 `refund-service`（已被 3 个需求使用）→ 二次确认「该仓库被 3 个需求使用，删除后这 3 个需求的 codebase 不会被影响，但注册表里就没了」→ 确认 → yaml 移除；codebase/ 目录完整保留 |
| 7 | A 编辑 `refund-service` 的 description → yaml 改了；3 个 codebase 目录不动 |
| 8 | 老用户（v1.0.6 时代的池 `repos/<name>/` 还有 5 个子仓库）首次启动 → 自动迁移进 `repos.yaml`（gitUrl 现成，description 留空）；启动日志「5 个旧仓库已迁移进 repos.yaml，可手动删除 ~/.aidevspace/repos/」 |
| 9 | 老需求 `req-001/repos/refund-service/`（worktree 形态）仍存在 → SSR 进 DRAFTING 不识别 → 显示「未关联」→ 用户重新关联走 clone 路径 → `req-001/codebase/refund-service/` 被建；老 `repos/` 目录仍在 |
| 10 | 拔网线点关联 → 50ms 内 SSE 推 `failed` → 红 banner「失败，详见日志」；对应 `.pending-` 被清；半成品目录不存在 → 点重试干净 |
