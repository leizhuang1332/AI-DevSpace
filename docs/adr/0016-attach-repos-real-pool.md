# ADR-0016: 关联仓库弹层对接真实仓库池

**Status:** Accepted
**Date:** 2026-07-20
**Deciders:** 项目负责人(经 `/grill-with-docs` 拍板)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 4(仓库管理 = 全局共享 + git worktree 隔离)
**关联 ADR:**
- [ADR-0003](0003-git-worktree-isolation.md) — 全局共享仓库存放点 `~/.aidevspace/repos/`(本 ADR 的数据源)
- [ADR-0007](0007-workspace-route-group-shell.md) — Web 工作台通过 Agent 路由调本地数据(本 ADR 落地点)
**关联 ticket:** `.scratch/new-requirement-modal/issues/06-attach-repos-real-pool.md`

---

## Context

### 起点

[CONTEXT.md](../CONTEXT.md) 决策 4 锁定 `~/.aidevspace/repos/<repo-name>/` 是仓库的物理根,但**前端 DRAFTING 工位的"关联仓库"弹层**目前只读 [`apps/web/src/lib/drafting.ts`](../apps/web/src/lib/drafting.ts) 里写死的 `GLOBAL_REPO_POOL` + `REFUND_DRAFTING.repos`(共 5-6 个 mock repo,代码注释明确标注"当前 mock 用,后续接入 agent API 后由 server 注入")。

后端 [`POST /api/requirement/:id/repos`](../apps/agent/src/routes/requirement.ts)(issue 02 ticket)已实装:Agent 能基于 repoId 创建 worktree —— 但**没有 GET 端点告诉前端"现在有哪些 repo 可选"**。这是 PRD §12 验收清单 "关联仓库" 路径上缺失的 read 侧一环。

### 用户决策(2026-07-20,`/grill-with-docs` Q1–Q9)

9 项决策,逐项拍板如下(下文 Decision 编号一致):

| # | 决策 | 选项 |
|---|---|---|
| Q1 | 真实数据源 | A: 扫 `~/.aidevspace/repos/` |
| Q2 | 扫描时机 | a: 每次 GET 实时 readdir,无缓存 |
| Q3 | 字段形状 | α: `{id, name}`;id = `repo-<dirname>`;不校验 `.git/` |
| Q4 | 拉取策略 | iii 混合:SSR 进入时拉 + 弹层打开时 refetch |
| Q5 | 端点 URL | p: `GET /api/repos` |
| Q6 | 空目录处理 | x: 返 `{repos: []}` 200 |
| Q7 | Ticket 位置 | m: `.scratch/new-requirement-modal/issues/06-...` |
| Q8 | Git URL 入口 | u: 保留 + hint + submit 禁用 |
| Q9 | ADR | ad: 新增本 ADR |

---

## Decision

### D1. 真实数据源 = 物理目录扫描(A)

仓库池的真相源是文件系统——`~/.aidevspace/repos/<repo-name>/` 的**子目录列表**,与决策 4 的"全局共享仓库存放点"语义对齐。

**不**采用配置清单 / `config.yaml` 字段方案:
- 配置清单与目录双写会引入漂移
- 决策 24(陪伴哲学)反对"让用户编辑配置文件"

### D2. 每次 GET 实时 readdir,无缓存(a)

`fs.readdirSync('~/.aidevspace/repos/')` 在仓库数 < 100 时耗时 < 5ms;缓存收益低,而 inotify 跨平台复杂度(Windows / macOS / Linux 三方 API 不同)与启动期缓存的"我刚加了仓库却没生效"诡异状态**成本远高于收益**。

**未来升级路径**:若 P2 仓库数膨胀到上千 + IO 显著,再加 LRU 缓存,但**缓存键必须包含 `fs.stat` 的 mtime 失效**(否则用户会再遇"加了不生效"问题)。

### D3. 字段形状最小集(α)

返回 `{id, name}` 两字段:
- `name` = 子目录原名(如 `refund-service`)
- `id` = `repo-<dirname>` slug

**不**返回默认分支 / 语言 / SSH URL 等元数据——本期 issue 01 ticket 已明确"基于默认 base 分支(main),可在仓库设置覆盖",用户**自己起统一分支名**,不读 base;元数据留给后续 `~/.aidevspace/repos/<name>/.aidevspace/repo.yaml` 提案。

**不**校验 `.git/` 子目录存在:
- 决策 30(空/加载/错误三态)的语义:目录即真相,误 `mkdir foo` 是用户自己的责任
- 校验 `.git/` 需要 `fs.stat` 每个子目录,IO 翻倍
- 选 α 是**显式接受**"非 git 目录也会出现"的代价

### D4. 拉取策略:SSR 初始 + 弹层 refetch(iii)

- 进入 DRAFTING 时 `getDraftingData()` 调一次 → RepoBar chips 立即可见(吻合 issue 08 既有体验)
- 弹层打开时 `useEffect` 触发 `fetchRepoPool()` → refetch 兜底(吻合 D2 的"实时"语义)
- refetch 失败 → 沿用当前 `data.repos` 不闪退

**不**采用单一策略的理由:
- 纯 SSR(i):用户中途 `mkdir` 新仓库后必须刷新页面,与 D2 的"实时"语义冲突
- 纯弹层 fetch(ii):首次开弹层有 ~50ms loading,违反决策 30 的"加载混合态"基线

### D5. URL = `GET /api/repos`(p)

workspace 顶层资源,与 `POST /api/requirement/:id/repos`(issue 02 ticket)形成**全局池 vs 需求关联**的对照:

| 方法 | URL | 含义 |
|---|---|---|
| `GET` | `/api/repos` | 列出全局仓库池(本期) |
| `POST` | `/api/requirement/:id/repos` | 把仓库关联到某个需求(issue 02) |

**不**采用 `/api/workspace/repos` 命名空间——workspace 概念在已落地端点里没出现过(只有 `bootstrap.ts` 启动),为 repos 单独造命名空间为时过早。

### D6. 目录不存在 → `{repos: []}` 200(x)

全新安装是合法状态,不是错误。前端 [`attach-repos-dialog.tsx:278`](../apps/web/src/components/attach-repos-dialog.tsx#L278) 已有 `availableRepos.length === 0` 的"暂无可选仓库"分支,**前端零改动**。

**不**采用 404(y):会让前端处理"非异常错误"增加 UI 复杂度
**不**采用自动 mkdir(z):违反 GET 幂等 + 无副作用的 HTTP 语义

### D7. Ticket 06 + 关联 PRD

新 ticket:`.scratch/new-requirement-modal/issues/06-attach-repos-real-pool.md`,沿用 PRD §12 验收清单的兑现路径。

---

## Consequences

### 正面

- **兑现 PRD §12 验收清单**:关联仓库路径 read 侧最后一公里闭环
- **决策 4 一致性**:目录即真相,前端不维护仓库元数据副本
- **零缓存负担**:无 LRU / 无 inotify / 无启动期 race condition
- **未来扩展清晰**:增元数据 → 提案 `.aidevspace/repo.yaml`;增缓存 → 加 mtime 失效键
- **现有测试兼容**:`GLOBAL_REPO_POOL` / `REFUND_DRAFTING.repos` 保留为 fallback,单测 fixture 不破坏

### 负面 / 已知代价

- **非 git 目录污染列表**:用户误 `mkdir` 后会在弹层看到;接受为 D3 代价
- **新增仓库须刷新页面才在 RepoBar 立即可见**:D4 iii 的妥协——只在弹层 refetch 时同步,RepoBar chips 用初始集(进入 DRAFTING 时拉的)
- **`assets/` 之类的"非仓库子目录"会出现在列表**:D3 接受;后续若要排除,需引入"以 `.git/` 存在为准"反例,见 D3 升级路径

### 对未来 ticket 的强约束

- 任何"添加新仓库"的 UI 入口(本期 u 决策保留的"+ 添加新仓库(粘贴 Git URL)")接入时,需新起 ADR(扩 D7)+ ticket,不能在本 ticket 范围偷偷加 `POST /api/repos`
- 任何元数据(默认分支 / 语言 / SSH URL)接入时,需新起 ADR 提案 `.aidevspace/repo.yaml` 落点 + `GET /api/repos` 返回结构升级
- 任何"加缓存"的优化,需新起 ADR 提案失效键策略 + 引入 mtime 监听成本评估

---

## Alternatives considered

仅记录**用户曾严肃考虑**但**被反选**的方案。详见 `/grill-with-docs` Q1–Q9 决策账本:

- 配置清单 B(读 `~/.aidevspace/repos.yaml`)→ 双写源漂移,淘汰于 Q1
- `config.yaml` 字段 C → 与 B 同病,淘汰于 Q1
- 启动期缓存 b → 加新仓库"不生效"诡异状态,淘汰于 Q2
- inotify 失效缓存 c → 跨平台复杂度,淘汰于 Q2
- git 校验 β → "空文件夹污染"非主要威胁,淘汰于 Q3
- 含默认分支 γ → 元数据提前优化,淘汰于 Q3
- 纯 SSR(i)/ 纯弹层 fetch(ii)→ 见 D4 理由
- `/api/workspace/repos` q → workspace 命名空间为时过早,淘汰于 Q5
- `/api/workspace` 含 repos 字段 r → 同 q
- 404 + E_REPO_DIR_NOT_FOUND y → 前端 UI 复杂度上升,淘汰于 Q6
- mkdir -p 自动建目录 z → GET 副作用,淘汰于 D6
- 隐藏 Git URL 入口 w → 未来加回 UI 二次成本,淘汰于 Q8
- 保留 Git URL 但继续 mock v → 报错信息奇怪,淘汰于 Q8

---

## 实施细节(本 ADR 落地的 ticket)

单 ticket:`.scratch/new-requirement-modal/issues/06-attach-repos-real-pool.md`,含 6 个子项:

1. Agent 端 `GET /api/repos` 路由(`apps/agent/src/routes/repos.ts` 新建)
2. shared 包 `ReposResponseSchema`(`packages/shared/src/repos.ts` 新建)
3. web 端 `lib/repo-attach.ts` 补 `fetchRepoPool()`
4. web 端 `lib/drafting.ts` 把 mock 常量换成 `await fetchRepoPool()`(带 fallback)
5. web 端 `drafting-zone.tsx` 弹层 refetch 兜底
6. web 端 `attach-repos-dialog.tsx` Git URL 入口收尾(hint + disabled)

**子项间无强顺序**:1-3 是底层管道(任意顺序起),4-6 是上层接入(等 1-3 落地后并行做)。

---

## 验证(端到端)

由 ticket 06 的"验收清单"小节承担(13 项),本节汇总视角:

1. **正常路径**:`mkdir ~/.aidevspace/repos/{foo,bar,baz}` → 进入 DRAFTING → 弹层显示 3 个真实仓库 → 勾选提交 → RepoBar 显示对应 chips
2. **空目录路径**:`rmdir ~/.aidevspace/repos/{foo,bar,baz}` 或目录不存在 → 弹层显示"暂无可选仓库"分支(已有 UI,不需改)
3. **中途新增可见性**:在 DRAFTING 中 `mkdir ~/.aidevspace/repos/newone` → 关闭弹层再打开 → 列表多一项(D4 iii 的 refetch 路径)
4. **失败 fallback**:拔网线 / Agent 关闭 → `getDraftingData()` 走 `REFUND_DRAFTING.repos` fallback → 弹层仍可见 mock 数据
5. **Git URL 入口收尾**:在弹层点 `+ 添加新仓库(粘贴 Git URL)` → 展开 input + hint → 填 URL → `[✓ 添加]` disabled → 取消后状态正确清空

---

## 不在范围(明确剔除)

- 元数据(默认分支 / 语言 / SSH URL)→ 后续 ADR 提案 `.aidevspace/repo.yaml`
- `POST /api/repos`(创建 + clone)→ 后续 ticket 接入,本 ADR 仅承载 read 侧
- 缓存层(LRU / mtime / inotify)→ P2
- 隐藏/移除 "+ 添加新仓库(粘贴 Git URL)" 入口 → D7 决策保留 + 禁用,等 POST 端点接入再启用
- 在 `meta.yaml` 里改 `repos[]` 字段时直接走 `GET /api/repos` 校验 → 不在本 ADR 范围
- 资源树扫描规则升级(把 `repos/` 当 workspace 级虚拟目录显示)→ 与本 ADR 正交

---

## 反向引用(本 ADR 引用 / 被引用)

**本 ADR 引用:**
- [CONTEXT.md](../CONTEXT.md) 决策 4(全局共享仓库存放点)
- [ADR-0003](0003-git-worktree-isolation.md)
- [ADR-0007](0007-workspace-route-group-shell.md)

**本 ADR 新增术语(进 [CONTEXT.md](../CONTEXT.md)):**
- `RepoPool`(仓库池):workspace 级的全局仓库集合,源自 `~/.aidevspace/repos/` 物理目录

**未来可能引用本 ADR 的场景:**
- 任何"添加新仓库" UI / API 工作都从本 ADR 起手(扩 D7)
- 任何仓库元数据接入都从本 ADR 起手(扩 D3)
- 任何仓库缓存优化都从本 ADR 起手(扩 D2)

---

## 关键提醒(给 ticket 实施者)

- **不要在 GET 路径上加副作用**(mkdir / clone / 写文件)——本 ADR D1 + D6 明确"目录即真相,读不写"
- **`GLOBAL_REPO_POOL` 保留**,只在 `getDraftingData()` 的 fallback 路径用,不要全局替换
- **Refetch 失败时不要清空当前列表**(D4 iii)——保留原数据 + 静默失败,符合决策 24(克制在场)
- **`{id, name}` 两字段足够**,不要顺手加 `defaultBranch` 之类——本 ADR D3 明确反对提前优化
- **Git URL 入口不要直接删**(决策 w 被否决)——保留 + hint + disabled 是过渡方案,后续 POST 端点接入时再启用
- **shared 包 schema 变更要同步 `apps/web` 与 `apps/agent`**——`ReposResponseSchema` 在两边都用,改一处忘一处会出 Zod parse 错