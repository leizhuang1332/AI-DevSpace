# ADR-0014: 状态软标签 + progress 派生 + 决策 15-v2(状态机启用但 AI 不推动)

**Status:** Accepted
**Date:** 2026-07-17
**Deciders:** 项目负责人
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15(修订), 决策 22, 决策 33, 决策 57
**关联 ADR:**
- [ADR-0002](0002-filesystem-as-database.md) — 纯文件系统存储(meta.yaml + 产物目录)
- [ADR-0009](0009-ai-failure-defense.md) — 自动 snapshot 机制(决策 47)
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 7 工位自适应壳层(本 ADR 范围内 status 用于工位地图渲染)
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 工位新定位(本 ADR 不影响)

**覆盖/改写:**
- **改写** [CONTEXT.md](../CONTEXT.md) 决策 15("不写状态机")的语义:状态机**启用**(status 是软标签 + UI 分组色 + 进度条),但**AI 仍不主动推动流程** —— 决策 15 后半段保留

**关联 ticket:** ticket 07a(后端 · 已批准)/ ticket 07b(前端)

---

## Context

### 起点

[CONTEXT.md](../CONTEXT.md) 决策 15 锁定"不写状态机"——AI 不推动流程,Skill 是"上下文触发的能力",不构成阶段;决策 22 锁定"需求状态色 = 分组共享色(4 色 + 灰);CLARIFYING 特殊(紫+警告红点);MVP 不带数字徽章"。

ticket 04(2026-07-16 落地)把 `POST /api/requirements` 实装,meta.yaml 字段冻结为 `{ id, title, createdAt }`,**显式不写 status**(注释引用决策 15 + 决策 57)。

但现状有张力:
- 决策 22 已锁定 StatusBadge 9 色分组 —— 状态是 UI 必备
- 决策 33 锁定需求列表副标题 = `N repo · N 天前更新`,但 mock 期"进行中需求"卡片有 ProgressBar + 工位文字
- 概览页 `(workspace)/page.tsx` 用 `ongoing = requirements.filter(r => r.status !== 'done' && r.status !== 'archived')` 过滤
- 需求列表页 `(workspace)/requirements/page.tsx` 用 `<StatusBadge status={r.status} />` 渲染 9 色徽章

**数据矛盾**:UI 强依赖 status 字段做分组色 / 进度条 / 过滤;**写盘契约不含 status**(决策 15 反对);用户实际从未追问"status 怎么来",因为 mock 期写死 9 个状态,UI 看似正常。

### 用户决策(2026-07-17,grilling 第 8 题)

> "选择方案 ①(保留 ProgressBar,API 返回 progress 由 status 派生),另外启用状态机,项目状态是很重要的信号,使用下来用户很关心项目进行到哪个阶段了。不过 ai 依然不主动推动开发流程"

用户明确:
1. **状态机启用** —— status 是"重要信号",用户关心项目进行到哪个阶段
2. **AI 不主动推动** —— 流程仍由用户主导,保留决策 15 后半段

### 故事提炼的两个核心约束

```
约束 1 · status 是 UI 信号灯
  ├─ 9 状态色分组(决策 22) → StatusBadge 必显
  ├─ 进度条信号(用户原话) → ProgressBar 必显
  └─ "进行中"过滤(dashboard 用) → 必传

约束 2 · AI 不主动推动流程
  ├─ status 变化由产物落地触发(派生),不由 AI 决策
  ├─ 流程推进 = 用户主动切工位 / 提交 / 决策
  └─ AI 在工位内的"工作进度"是 status 反映,不是 status 驱动
```

### 与原决策 15 的核心矛盾

| 维度 | 原决策 15 | 用户新要求 |
|---|---|---|
| status 字段 | 反对(写盘无 status) | 启用(派生给 UI) |
| UI 分组色 | 由 mock 临时提供 | 真实数据派生(10 状态) |
| 流程推进 | AI 不推动 | AI 不推动(**保留**) |
| 状态机语义 | 无 | 软标签(UI 信号,非流程驱动) |

### 关键发现:决策 15 实质是"AI 不推动",不是"无 status"

回看决策 15 原文:

> **15 | 流程 = 不写状态机**——AI 不推动流程;Skill 是"上下文触发的能力",不构成阶段

决策 15 实际只锁定"AI 不推动",**没有禁止 status 字段**。ticket 04 meta.yaml 不写 status 是对决策 15 的**过严解读**(把"无 status" 当作 "无 status 字段")。

本 ADR 把决策 15 拆为两半:
- **保留**:AI 不主动推动流程(status 变化不来自 AI 决策)
- **修订**:status 字段不写盘(由产物目录派生,不持久化到 meta.yaml) —— 这是 D4

---

## Decision

通过 7 个决策(D1-D7),沉淀当前会话 9 个 grilling 决策里**与产品/架构语义相关**的部分:

### D1 · 状态机启用(status 是软标签 + UI 信号)

**原文**:需求有 status 字段(10 状态枚举),用于:
- StatusBadge 9 色分组渲染(决策 22)
- ProgressBar 进度条信号(用户原话)
- "进行中"过滤(概览页 dashboard)
- 工位地图"当前/已完成/待办"状态(ADR-0011 §6)

**说明**:
- **不**驱动 UI 流转(决策 15 保留)—— 页面跳转 / Skill 触发 / 工作流推进仍由用户主动操作
- **不**持久化(详见 D4)—— meta.yaml 仍然只 3 字段,status 由文件系统产物目录派生
- status 是**软标签**:产物在哪个目录,UI 就显哪个色;产物变化,status 自动跟随

**与"硬状态机"的区别**:
- 硬状态机:状态机驱动 UI 流转(状态 A → 状态 B 时,UI 自动跳到下一屏)
- 软标签:UI 反映 status,但不根据 status 决定下一步

### D2 · status 派生规则(方案 β — 按产物目录"最高进度"扫 9 + 1 状态)

**原文**:status = `deriveStatus(reqDir)`,由文件系统扫描得到,**优先级从高到低**:

| # | 判定条件 | 派生 status | 备注 |
|---|---|---|---|
| 1 | 顶层 `.archived` 标记文件存在 | `archived` | 优先级最高,覆盖其他 |
| 2 | `wrapup/` 子目录存在 | `done` | 归档已落盘 |
| 3 | `plan/tasks.md` 存在 | `planning` | 优先于 implementing(plan 是 implementing 前置) |
| 4 | `design/` 子目录存在 | `designing` | |
| 5 | `clarifying/` 子目录存在 | `clarifying` | |
| 6 | `analysis/` 子目录存在 | `analyzing` | |
| 7 | `requirement.md` 存在且非空(> 10 字节) | `drafting` | 与 `draft` 区分 |
| 8 | 其他(空目录 / meta.yaml 损坏兜底) | `draft` | |

**10 状态枚举**(定义在 `@ai-devspace/shared`):

```ts
export const RequirementStatusSchema = z.enum([
  'draft',          // 空目录 / meta.yaml 损坏
  'drafting',       // requirement.md 存在但空白或 < 10 字节
  'analyzing',      // analysis/ 存在
  'clarifying',     // clarifying/ 存在
  'designing',      // design/ 存在
  'planning',       // plan/tasks.md 存在
  'implementing',   // (本期 P1+ 派生;暂未触发,见 D7)
  'submitting',     // (本期 P1+ 派生)
  'done',           // wrapup/ 存在
  'archived',       // 顶层 .archived 标记
])
```

**说明**:
- 优先级**严格**按表顺序(archived > done > planning > designing > clarifying > analyzing > drafting > draft)
- 不能写成"扫到哪个目录就 return"的低优先级错乱
- `plan/tasks.md` 存在 → `planning`,**优先于** `implementing`,因为 plan 是 implementing 的前置(决策 15 不驱动流程,但产物目录的物理顺序反映了"规划在前,实施在后")
- `implementing` / `submitting` 本期 P1+ 派生(ticket 07a 范围不强制要求,见 D7)
- meta.yaml 损坏 / 残缺 reqDir → 跳过,不抛错(决策 30 容错)

### D3 · progress 由 status 派生(`STATUS_PROGRESS_MAP`)

**原文**:`progress = STATUS_PROGRESS_MAP[status]`,映射规则:

```ts
export const STATUS_PROGRESS_MAP: Record<RequirementStatusT, number> = {
  draft: 0,
  drafting: 0,
  analyzing: 20,
  clarifying: 30,
  designing: 40,
  planning: 50,
  implementing: 70,
  submitting: 90,
  done: 100,
  archived: 100,
}
```

**说明**:
- progress 是 0-100 整数(对应 ProgressBar 渲染宽度)
- 跨端契约,放 `@ai-devspace/shared`,改一处生效(web RequestCard + agent listRequirements + future web 列表百分比)
- monotonic non-decreasing:`draft < analyzing < ... < done`(测试覆盖)
- `draft` / `drafting` 同为 0(用户还没开始干活)
- `done` / `archived` 同为 100(完成态)

### D4 · meta.yaml 不持久化 status 字段(派生机制)

**原文**:`~/.aidevspace/requirements/<id>/meta.yaml` 字段仍然 = `{ id, title, createdAt }`,**不写 status**。

**说明**:
- 决策 15 修订后,status 仍不入盘 —— 因为 status 可由文件系统**实时派生**(`deriveStatus(reqDir)` O(n) 扫描),落盘反而引入"status 与产物不同步"的维护问题
- ticket 04 meta.yaml 字段冻结决定**保留**
- 任何回写 status 的 PATCH 接口(本期**不实装**,P1+ 再说)
- 如果未来需要"用户手动标记 status"(如强制 archived),走"标记文件"方案(如 `.archived` 顶层文件)而非改 meta.yaml

### D5 · AI 仍不主动推动流程(决策 15 后半段保留)

**原文**:AI 在工位内的所有"工作进度"动作,都不**主动**触发 status 变化。

**说明**:
- AI 写文件 → 文件出现在某个目录 → status 派生**自动**反映(被动跟随)
- AI 不可主动说"这个需求已 planning,改 status"(无此 API)
- 用户切工位 / 提交 / 决策 → 不改 status(决策 15 反对状态机驱动 UI 流转)
- 决策 25 锁定的"AI 主动推送"全部取消 —— 本 ADR 不修改决策 25
- 决策 43/44 锁定的"5 类必沉默 + 5 条 AI 主动关心红线"全部保留

**派生 vs 主动的边界**:
- ✅ 允许:AI 写 `analysis/foo.md` → status 自动从 `drafting` 变 `analyzing`(派生)
- ❌ 不允许:AI 调某个 API "set status to designing"

### D6 · 跨端契约位置:`@ai-devspace/shared`

**原文**:以下 3 项放 `@ai-devspace/shared/requirement.ts`:
- `RequirementStatus` 类型(`z.enum` 派生)
- `STATUS_PROGRESS_MAP` 常量
- `RequirementSummary` 列表 DTO 字段集

**说明**:
- 决策 36 锁定"三件套单一事实源"
- web 端 `status-badge.tsx` / `overview-page.tsx` / `requirements/page.tsx` 全部改 import 路径(从 `mock.ts` → `@ai-devspace/shared`)
- agent 端 `RequirementService.listRequirements()` 派生 status 后,直接 `STATUS_PROGRESS_MAP[status]` 算 progress,响应给 web
- 改枚举 / 改映射只动一个文件

### D7 · 本期 P1+ 状态派生边界(明确剔除)

**原文**:本期(ticket 07a / 07b)实装的 status 派生**只覆盖 8 个状态**(`draft` / `drafting` / `analyzing` / `clarifying` / `designing` / `planning` / `done` / `archived`);`implementing` / `submitting` **本期不实装**派生规则。

**说明**:
- `implementing` 通常意味着"worktree 有 commit"或"tasks.md 有 in-progress 任务" —— 需要扫 commit log 或 tasks.md 状态,实现复杂
- `submitting` 通常意味着"PR 已发起等待 review" —— 需要 gh CLI 集成或 PR metadata
- 本期 `STATUS_PROGRESS_MAP` 仍然包含这 2 个状态(占位,值为 70 / 90),但**派生时无法落到这 2 个状态**
- P1+ ticket 增补派生规则(可能需要 `executing/` 子目录 + tasks.md 状态机扫描)
- 视觉影响:`implementing` 状态永远不会显(RequestCard 进度条永远停在 50%),**接受临时视觉差**

---

## 架构图

```
┌──────────────────────────────────────────────────────────────┐
│ 共享契约层  @ai-devspace/shared/requirement.ts                │
│  ├─ RequirementStatusSchema (z.enum 10 项)                    │
│  ├─ STATUS_PROGRESS_MAP  (Record<status, 0-100>)             │
│  └─ RequirementSummarySchema (z.object 7 字段)                │
└──────────────────────────────────────────────────────────────┘
                  ↑                              ↑
                  │ import                       │ import
                  │                              │
┌─────────────────┴────────────┐  ┌──────────────┴────────────────┐
│ Agent 端                     │  │ Web 端                        │
│ RequirementService          │  │ RequestCard / StatusBadge     │
│ .listRequirements()         │  │ (导入 STATUS_PROGRESS_MAP)    │
│  ├─ 扫 requirements/ 目录   │  │                                │
│  ├─ 读 meta.yaml             │  │ fetchRequirementsServer()     │
│  ├─ 调 deriveStatus(reqDir)  │  │ (RSC 内 server-side fetch)     │
│  ├─ progress = MAP[status]   │  │                                │
│  ├─ 读 repos/ 子目录列表     │  │ router.refresh() (SSE 触发)   │
│  └─ mtime → updatedAt        │  │                                │
│                              │  │ SSEInvalidator (client)        │
│ GET /api/requirements        │  │  订阅 /api/agent/events/reqs   │
│   返 { requirements: [...] } │  │  收到 requirement_created      │
│                              │  │  → router.refresh()            │
│ SseHub.publish('requirements'│  │                                │
│   , { type: 'requirement_   │  │                                │
│   created', ... })            │  │                                │
│ (POST /api/requirements 成功)│  │                                │
└──────────────────────────────┘  └────────────────────────────────┘
```

---

## 与决策 22 / 33 / 57 的关系

| 原决策 | 与本 ADR 关系 |
|---|---|
| **决策 22**(需求状态色 = 4 色 + 灰) | ✅ 保留。9 状态 + 10 状态枚举 = StatusBadge 必须显所有 10 色的映射,补 `drafting` 色 |
| **决策 33**(需求列表副标题 = `N repo · N 天前更新`) | ✅ 保留。副标题由 `repos.length` + `updatedAt` 算,不影响 status |
| **决策 57**(`/requirements/[id]/` 默认 redirect 不基于 status) | ✅ 保留。`/requirements/[id]/` 跳 `cookie last_zone` 或默认 `drafting`,status **不**驱动跳转 |
| **决策 47**(自动 snapshot 30 天) | ✅ 保留。本 ADR 范围内 status 派生无 snapshot 副作用;P1+ 引入"重扫"按钮时(snapshot 范围内) |
| **决策 15**(不写状态机 / AI 不推动) | ⚠️ **本 ADR 修订**。前半段("不写状态机")改为"软标签 + 派生";后半段("AI 不推动")**保留**(详见 D5) |
| **决策 15-v2**(本 ADR 引入) | ✅ 状态机启用(信号灯 + 进度条)+ AI 不推动流程 = **本 ADR 决策 15 修订后语义** |

---

## Consequences

### 正面

- ✅ **UI 真实数据驱动**:概览页 / 列表页 / StatusBar tabs / StatusBadge 全部走真实 status,不再有 mock vs 真实数据割裂
- ✅ **跨端契约统一**:`STATUS_PROGRESS_MAP` 一份,web 端 RequestCard 与 agent 端 listRequirements 共用
- ✅ **零持久化维护成本**:status 由文件系统派生,不会出现"status 字段与产物不同步"的 bug
- ✅ **决策 15 精神保留**:AI 不主动推动流程,status 派生是"被动跟随"
- ✅ **测试覆盖 9 状态**:派生规则表驱动,每条规则对应一个 it case

### 负面

- ⚠️ **`implementing` / `submitting` 状态本期 P1+**:RequestCard 进度条视觉永远停在 50%,用户可能困惑
- ⚠️ **`requirement.md` 空白判断阈值 10 字节**:边界 case(短 PRD 起步)可能错落 `drafting`
- ⚠️ **`.archived` 标记文件机制需新加**:P1+ 实施,本期用户无法手动归档需求
- ⚠️ **status 派生是 O(n) 扫描**:100+ 需求时单次 list 100ms+,P1+ 需考虑缓存 / 索引

### 中性

- 🔄 `mock.ts` 仍保留 95% 内容,仅 `requirements` 数组 + `RequirementStatus` 类型删除(07b 范围)
- 🔄 `STATUS_DOT` / `VARIANTS` Record 必须加 `drafting` 键(否则类型报错)
- 🔄 4 个 `[id]/...` 子路由的 `requirements[0]` fallback 保留(N+1 反模式,07c 优化)

---

## 实施细节(本 ADR 落地的 ticket)

### ticket 07a(后端 · 已批准)

- 步骤 1:`packages/shared/src/requirement.ts` 追加 `RequirementStatus` / `STATUS_PROGRESS_MAP` / `RequirementSummarySchema`
- 步骤 2:`apps/agent/src/services/RequirementService.ts` 加 `listRequirements()` + 3 个 private helper(`deriveStatus` / `deriveRepos` / `deriveUpdatedAt`)
- 步骤 3:`apps/agent/src/routes/requirement.ts` 替换 L64-66 501 stub;L134 后追加全局 publish
- 步骤 4:新建 `apps/agent/src/sse/globalEventsRoute.ts` 全局 SSE 通道
- 步骤 5:写本 ADR(本文件)

### ticket 07b(前端 · 已写 plan,待批准)

- 步骤 1-3:RSC 化(3 个 page + layout + 4 个子路由)
- 步骤 4-5:新建 `requirement-list.ts` / `requirement-list.server.ts` / `sse-invalidator.tsx` / `route.ts`
- 步骤 6:mock.ts 收敛(删 `requirements` + 删 `RequirementStatus` + alias `Requirement` → `RequirementSummary`)
- 步骤 7:4 个 `RequirementStatus` 消费方改 import + `STATUS_DOT` / `VARIANTS` / `STATUS_FILTERS` 同步加 `drafting` 键
- 步骤 8:单测覆盖

---

## 验证(本 ADR 落地后的端到端验证)

### 1. status 派生正确性

```bash
# 准备 8 个不同状态的 reqDir
mkdir -p ~/.aidevspace/requirements/req-001-{a,b,c,d,e,f,g,h}
echo "id: req-001-a" > ~/.aidevspace/requirements/req-001-a/meta.yaml
echo "title: 空目录" >> ~/.aidevspace/requirements/req-001-a/meta.yaml
# (无其他文件) → 期望 status='draft'

echo "id: req-001-b" > ~/.aidevspace/requirements/req-001-b/meta.yaml
echo "title: drafting" >> ~/.aidevspace/requirements/req-001-b/meta.yaml
echo "# 退款功能优化" > ~/.aidevspace/requirements/req-001-b/requirement.md
# 期望 status='drafting'

echo "id: req-001-c" > ~/.aidevspace/requirements/req-001-c/meta.yaml
echo "title: analyzing" >> ~/.aidevspace/requirements/req-001-c/meta.yaml
mkdir ~/.aidevspace/requirements/req-001-c/analysis
# 期望 status='analyzing'

# ... 等等

# 验证 GET /api/requirements 返回
curl -s http://localhost:7777/api/requirements -H "x-aidevspace-token: $TOKEN" \
  | jq '.requirements | map({id, status, progress})'
# 期望 8 个元素,status / progress 与派生一致
```

### 2. 优先级严格性

```bash
# req-001-z:有 wrapup/ + .archived 同时存在
mkdir -p ~/.aidevspace/requirements/req-001-z/{wrapup,}
touch ~/.aidevspace/requirements/req-001-z/.archived
# 期望 status='archived'(archived 优先于 done)
```

### 3. progress 映射单调性

```bash
# shared 包单测
pnpm -F @ai-devspace/shared test -- -t "STATUS_PROGRESS_MAP"
# 期望:monotonic non-decreasing 断言通过
```

### 4. AI 不主动推动(回归测试)

- 启动 agent + web
- 用户在 ANALYZING 工位跑 Skill,AI 写产物到 `analysis/`
- status 应**自动**从 `drafting` 变 `analyzing`(派生跟随,非 AI 主动调 API)
- AI 不可见 `set status` API endpoint
- ticket 07a 实装后,`PATCH /api/requirement/:id` 仍是 501 stub(决策 4 不引入)

---

## 不在范围(明确剔除)

- ❌ **`PATCH /api/requirement/:id` 回写 status 接口** —— 决策 4 D4 明确"不写 status",P1+ 再说
- ❌ **`.archived` 标记文件的创建入口 UI** —— P1+ 单独 ticket,本期用户无法手动归档
- ❌ **`implementing` / `submitting` 派生规则** —— P1+ ticket,需要扫 commit / tasks.md / PR metadata
- ❌ **status 派生缓存** —— 100+ 需求才需要,P1+ 再说
- ❌ **status 派生并发安全** —— `readdirSync + statSync` 同步调用,本期单进程,无并发问题
- ❌ **其他工位的 status override** —— P1+ 如有"用户强制 archived"需求,再讨论

---

## 反向引用(本 ADR 引用 / 被引用)

### 引用本 ADR 的文件

- `packages/shared/src/requirement.ts` —— 注释"ticket 07a 决策 72 / ADR-0014 状态软标签 + progress 派生"
- `apps/agent/src/services/RequirementService.ts:listRequirements()` 注释
- `apps/agent/src/services/RequirementService.ts:deriveStatus()` 注释
- `apps/web/src/components/status-badge.tsx` `VARIANTS` / `STATUS_DOT` 注释(待 07b)
- `apps/web/src/components/overview-page.tsx` `StatusDot` 注释(待 07b)
- `apps/web/src/lib/requirement-overview.ts` 注释(待 07b,若改)
- `apps/web/src/lib/requirement-list.ts` 注释(待 07b)
- `apps/web/src/lib/requirement-list.server.ts` 注释(待 07b)

### 本 ADR 引用的 ADR

- [ADR-0002](0002-filesystem-as-database.md) — meta.yaml + 产物目录作为状态派生的数据源
- [ADR-0009](0009-ai-failure-defense.md) — snapshot 机制(D7 "重扫"按钮与 snapshot 协同)
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 工位地图的 status 渲染需求
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 工位产物(technical-brief.md / modules.yaml)作为 `analyzing` 状态派生依据

### 本 ADR 改写 / 覆盖

- **改写** [CONTEXT.md](../CONTEXT.md) 决策 15(不写状态机 → 状态机启用 + 软标签 + 派生;AI 不推动保留)
- **不修改**决策 15 后半段("AI 不推动流程")—— 语义保留

### 同步更新需求

- [CONTEXT.md](../CONTEXT.md) 决策 15 注释需追加 ADR-0014 引用(本次会话不直接改 CONTEXT.md,留给 ticket 07a/07b 实施时一并更新)
- v1.0.3 增量决策表需追加"决策 15-v2"(若项目维护增量决策表,留给后续)

---

## 关键提醒(给 07b 实施)

1. **不要回写 status** —— 即使 web 端有 `<StatusBadge status={r.status} />` 的视觉错位需求,**也不通过 PATCH 接口改 status**;status 永远是派生量
2. **优先 map 完整性** —— `STATUS_DOT` / `VARIANTS` / `STATUS_FILTERS` 加 `drafting` 键必须与 `STATUS_PROGRESS_MAP` 同步,缺一个都会类型报错
3. **容错优于完美** —— meta.yaml 损坏跳过(不抛),reqDir 残留(非 `req-NNN-*` 格式)不计入 list
4. **测试驱动** —— 派生规则表驱动,每个 status 一个 it case,优先级 + 排序 + 容错全覆盖
5. **跨端契约位置严格** —— `STATUS_PROGRESS_MAP` 必须 `@ai-devspace/shared`,web 端不允许自己写一份;否则改枚举会双份维护
