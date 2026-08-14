# ADR-0030: 仓库注册表化 + 需求级独立 clone

**Status:** Accepted
**Date:** 2026-08-14
**Deciders:** 项目负责人（经 `/grill-with-docs` 拍板，决策账本见 `.scratch/repo-registry-clone/decisions.md`）
**Supersedes:** [ADR-0003](0003-git-worktree-isolation.md)（全文）/ [ADR-0016](0016-attach-repos-real-pool.md) D1、D3、D5
**关联 ticket:** `.scratch/repo-registry-clone/`

---

## Context

[ADR-0003](0003-git-worktree-isolation.md) 锁定「全局仓库池 + git worktree 多需求隔离」：池仓库 `~/.aidevspace/repos/<name>/` 物理落盘，每个需求下用 `git worktree add` 出独立 worktree 副本。[ADR-0016](0016-attach-repos-real-pool.md) D1 进一步把仓库池的真相源固化为该物理目录的 readdir，**显式否决**「读 `~/.aidevspace/repos.yaml`」的配置清单方案（理由：与目录双写会漂移；决策 24 反对让用户编辑配置文件）。

这套架构运行 3 个月，积累了两个真实诉求：

1. **配置可移植**：开发者希望把「我用了哪些仓库」提交进 git、分发给同事、同步到另一台机器。物理目录是二进制的，达不到
2. **简化心智模型**：worktree 是个需要专门解释的 git 高级概念，AI 出错、IDE 误识别、跨设备不可移植等边角问题持续消耗沟通成本

**`git clone` 是所有人都懂的概念**；「池里存一份主仓库 + 多个 worktree 共享 `.git`」不是。

## Decision

**`~/.aidevspace/repos.yaml` 注册表 + 需求级独立 `git clone` 副本**。

### D1. 仓库池变为注册表

- 真相源：`~/.aidevspace/repos.yaml`（独立单文件，顶层 `repos:` 数组），与 `config.yaml` 职责分离——后者是本机设置（theme / agentEndpoint / workspaceRoot），前者是可移植清单
- 字段最小集（3 字段）：
  ```yaml
  version: 1
  repos:
    - name: refund-service          # 唯一标识，全局文件名安全
      gitUrl: git@github.com:co/refund-service.git
      description: 退款核心服务
  ```
- **不加 `defaultBranch`**：base 分支直接用 clone 下来的 remote HEAD
- **不加 `id` 字段**：name 即标识，契约上下游全部按 name 引用，删除既有 `repo-<name>` 前缀的派生链

### D2. 池里不再有源码

`~/.aidevspace/repos/` 目录从 `WorkspaceService.SUBDIRS` 移除，agent 启动时若发现该目录还有子仓库，**一次性自动迁移**进 `repos.yaml`（读 `git remote get-url origin` 拿 gitUrl，description 留空）—— **不删**旧目录（里面可能有未 push 的提交），在 UI 提示「旧目录可手动删除」。

### D3. 需求关联 = 独立 git clone

- 路径：`~/.aidevspace/requirements/<req-id>/codebase/<repo-name>/`
- 命令：
  ```bash
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="" SSH_ASKPASS="" \
    git clone <gitUrl> <codebasePath>            # 完整 clone（无 shallow）
  cd <codebasePath> && git checkout -b <branch>  # 基于 remote HEAD
  ```
- **串行变并行 + 异步**：POST 立即返 202，每个仓库独立任务；通过既有 `requirementEventsRoute` SSE 推 `repo-clone-progress` 事件
- **状态落盘**：`codebase/.pending-<name>` 标记——F5 后 SSR 仍能读到「⏳ 克隆中」；agent 启动时扫残留标记 → 清理半成品目录
- **幂等**：目录已存在 → `E_REPO_ALREADY_ATTACHED`，不重复 clone、不摧已有改动
- **失败清理**：clone 中途失败（网络断 / 磁盘满 / 认证失败）→ `rm -rf` 半成品目录，保证「要么完整要么不存在」
- **git 凭据**：完全依赖宿主机（SSH agent / `~/.ssh/` / credential helper），**零密钥落盘**；`E_AUTH` → 提示用户配 git 凭据

### D4. 路径重命名

| 旧（ADR-0003 时代） | 新 |
|---|---|
| `~/.aidevspace/requirements/<id>/repos/<name>/`（worktree） | `~/.aidevspace/requirements/<id>/codebase/<name>/`（clone） |

**不迁移**已有 worktree 形态的目录：两种物理形态（worktree 的 `.git` 是文件，clone 的 `.git` 是真目录）混在同一套代码路径里会埋雷。老需求显示为未关联，用户重新关联即走 clone。worktree 形态一次性出局。

### D5. 错误码调整

| 旧码 | 新语义 |
|---|---|
| `E_REPO_NOT_FOUND` | 注册表无此条目 |
| `E_BASE_BRANCH_NOT_FOUND` | **删除**（clone 下来必然有 HEAD） |
| `E_BRANCH_EXISTS` | **删除**（全新 clone 不可能撞本地分支） |
| `E_INVALID_BRANCH_NAME` / `E_REQUIREMENT_NOT_FOUND` | 保留 |
| `E_DISK_FULL` / `E_NETWORK` / `E_AUTH` / `E_INTERNAL` | 保留 |
| **新增** | `E_REPO_ALREADY_ATTACHED` / `E_REPO_NAME_EXISTS` |

### D6. `/repos` 页面重设计

- 卡片 = 仓库名 + gitUrl + 描述 + **「被 N 个需求使用」**（实时从 `requirements/*/codebase/` 派生）
- 列表页顶部文案「N 个仓库 · M 个 worktree」→「N 个仓库」
- 详情页 `/repos/<name>` 从「worktree 列表」改为「关联需求列表 + 分支名 + 本地路径」
- 客户端过滤（仓库数 <100，加后端 query param 是过度设计），placeholder 从「仓库名 / URL / **分支**…」改为「仓库名 / 地址 / 描述…」

### D7. DRAFTING 弹层收尾

兑现 [ADR-0016](0016-attach-repos-real-pool.md) D7 留的欠账：

- **不启用**"+ 添加新仓库（粘贴 Git URL）" 内嵌入口（弹层只负责「从注册表里选」）
- 改为一行带链接的提示「没找到？去仓库页添加 →」，跳转 `/repos`

### D8. `POST /api/repos` 接入

页面"+ 添加仓库"调 `POST /api/repos {name, gitUrl, description}`：
- 必跑 `git ls-remote --heads <url>` 验证可达 + 凭据可用
- name 唯一性检查 → 重复返 `E_REPO_NAME_EXISTS`
- 通过后原子写入 `repos.yaml`（读-改-写全文件，yaml 库内置的并发风险用一个 200ms 退避的轻量重试覆盖）

`PUT /api/repos/:name` / `DELETE /api/repos/:name` 同源：
- 编辑：改 yaml 对应条目，**不**碰已 clone 的 codebase
- 删除：被 N≥1 需求使用时二次确认告知影响，确认后从 yaml 移除，**绝不 rm** 任何 `codebase/<name>/`

## Consequences

### 正面

- **可移植**：单文件 `repos.yaml` 可提交、分发、搬窝
- **心智简化**：所有需求独立 clone，「需求 A 改坏文件」绝不影响「需求 B 的同一文件」
- **跨设备无差异**：worktree 形态依赖中心池的 `.git/worktrees` 注册，跨设备失效；clone 是自包含
- **AI / IDE 友好**：每个 codebase 是独立 git 仓库，VSCode/IDEA 行为可预期

### 负面 / 已知代价（必须在 ADR 里记下）

- **磁盘 n 倍**：10 个需求 × 5 个仓库 = 50 份完整 clone。**这正是 ADR-0003 当年否决此方案的理由**——本次以「配置可移植 + 心智简化」的名义明确接受这个代价。`/repos` 页面在用户首次大量关联时**应当**显式提示「将消耗约 X GB 磁盘」
- **首次关联从秒级变分钟级**：本地 worktree → 网络 clone；SSE 进度让等待可见，但**不**让等待变快
- **workspace `.gitignore` 必须补 `requirements/*/codebase/`**：否则若 workspace 自身是 git 仓库，大量嵌套 git 仓库会污染版本管理
- **历史不丢但工作不丢**：老需求重新关联时，clone 下来的是上游 HEAD，**不是**用户上次在 worktree 里写的内容；若有未 push 的本地提交，需要事先 push 或手动备份
- **多需求并发 clone 同一仓库无复用**：10 个需求 × 1 个仓库 = 10 次网络拉取。考虑过 `git clone --reference` 用裸镜像做加速，但**违背「简化心智模型」**决策，舍弃

### 终态架构

```
~/.aidevspace/
├── repos.yaml                         ← 真相源（注册表，3 字段）
├── requirements/
│   └── req-001/
│       ├── meta.yaml                  ← branchName 持久化
│       ├── codebase/                  ← 独立 clone 副本
│       │   ├── refund-service/
│       │   └── order-service/
│       │   └── .pending-<name>        ← 克隆中标记
│       └── ...
└── ...
```

## Alternatives Considered

- **维持 ADR-0003 + ADR-0016 不变**：保留可移植性的需求在「yaml 配置 vs 物理目录」上无法解，淘汰
- **裸镜像 + `--reference` 加速**：`repos/<name>.git` 裸镜像共享 objects 池，省带宽。违背「简化心智模型」（又要解释 bare repo / reference），淘汰
- **「不存源码的物理目录 + yaml 注释」**：用目录表达分组、yaml 只存元数据。维护两套机制反而比纯 yaml 更复杂，淘汰
- **保留 worktree 兼容双形态**：老需求继续走 `repos/`，新需求走 `codebase/`。两套物理形态（`.git` 文件 vs `.git` 目录）的清理逻辑会长期埋雷，淘汰

## 实施范围

**单 ticket** `.scratch/repo-registry-clone/`，含 7 个子项：

1. shared 包 schema 改造：`RepoRegistryEntry` 取代 `RepoPoolEntry`，字段 `{name, gitUrl, description}`；`AttachReposRequest/Response` 同步去 `repoId` 改 `repoName`
2. `routes/repos.ts` 重写：`GET /api/repos` 改读 `repos.yaml`；新增 `POST /api/repos`（带 `ls-remote` 验证）/ `PUT /api/repos/:name` / `DELETE /api/repos/:name`
3. `routes/requirement.ts` + `RequirementService`：新增 `CodebaseManager`（替换 `WorktreeManager`），`attachRepos` 改异步并行 + SSE 进度 + 落盘 pending 标记 + 失败清理
4. `WorkspaceService`：`SUBDIRS` 移除 `'repos'`；新增 `repos.yaml` 初始化 + 旧 `repos/` 目录一次性自动迁移；`GITIGNORE_CONTENT` 补 `requirements/*/codebase/`
5. `createDefaultGitExec()`：强制注入 `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=""` / `SSH_ASKPASS=""`
6. 前端 `lib/drafting.server.ts` + `lib/repo-attach.ts` + `repo-bar.tsx` + `attach-repos-dialog.tsx` + `drafting-zone.tsx` 跟改契约
7. `/repos` 页面 + `/repos/[name]` 详情页 + `data/mock.ts` 全线重写

测试：旧 `repos-attach.e2e.test.ts` 整个改写为 clone 版；新增 yaml 并发写入、`ls-remote` 失败、pending 标记扫描等单测。

## 验证（端到端）

1. **可移植路径**：用户 A 写 `repos.yaml` → `cp` 给用户 B（同名 workspace）→ 进入 DRAFTING 立即看到 5 个仓库，无需任何 `mkdir`
2. **磁盘代价可见**：DRAFTING 关联弹层提交前若预计 clone > 500MB，显示预估大小
3. **失败清理**：拔网线点关联 → 部分仓库 SSE 推 `repo-clone-failed` → 状态进红 banner，**未成功的半成品目录已被 `rm -rf` 清理**，可立即重试
4. **pending 标记**：clone 进行中按 F5 → 重进 DRAFTING → 关联中的仓库仍显示「⏳ 克隆中」；agent kill 后重启 → 残留半成品目录被扫到并清理
5. **删除非破坏性**：删除 `refund-service` 仓库条目 → 已 clone 的 `requirements/req-001/codebase/refund-service/` 仍完整存在，UI 仅显示该仓库从注册表消失

## 不在范围（明确剔除）

- **shallow clone 加速**：`--depth 1` 会丢掉历史、限制 rebase、妨碍 AI 做历史分析；用户接受分钟级首次等待
- **裸镜像 / `--reference` 共享 objects**：见「负面 / Alternatives Considered」
- **yaml 字段加密 / 凭据回写**：凭据完全依赖宿主机配置，yaml 不落任何密钥
- **跨 workspace 共享注册表**：本期单 workspace 持有 `repos.yaml`；多 workspace 共享是 P2 课题
- **元数据扩展**（默认分支 / 语言 / 克隆大小 / 最后 fetch）：本期严格 3 字段
- **加密 / 签名 / 审计**：配置可移植带来误用风险（拿到别人 yaml 直接 clone 陌生仓库），但元信任问题属于 P2

## 反向引用

**本 ADR 引用：**
- [ADR-0003](0003-git-worktree-isolation.md)（supersede 全文）
- [ADR-0016](0016-attach-repos-real-pool.md)（supersede D1 / D3 / D5）
- [CONTEXT.md](../CONTEXT.md)（术语表随之更新）

**未来可能引用本 ADR：**
- 任何 yaml 字段扩展（默认分支 / 凭据回写）需新起 ADR 提案
- 任何 clone 加速（shallow / mirror / `--reference`）需新起 ADR 重启成本收益评估
- 任何「多 workspace 共享注册表」机制从本 ADR D1 起手
