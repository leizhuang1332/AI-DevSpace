---
Status: ready-for-agent
Type: prd
Created: 2026-08-06
Feature: board-section
Covers: ADR-0024 / ADR-0025 / ADR-0026 / ADR-0027 / ADR-0028 + Round 2 UI 决议(5 列颜色 A / 中等密度 / field chips a 折叠 / 详情页右栏 toggle)
Source: docs/design/pages/{board-color-options,board-detail-field-chips,board-detail-final}.html
---

# 任务看板(TaskCard / BOARD section)前端落地 PRD

## Problem Statement

用户在 AI-DevSpace 平台把需求拆成可独立推进的工作项时,没有"工作项级"的产品形态:

- **Requirement** 是端到端需求项目粒度过粗(整个「电商后台接入 Stripe」)
- **`plan/tasks.md`** 是 EXECUTING-zone 内的 AI 执行序列,粒度过细且用户无法独立推进
- 用户用 **clarifying / designing / executing** 三工位分别独立路由,迫使用户在 4 个 URL 之间跳:`/requirements/[id]/clarifying/` `/designing/` `/executing/` 加上 Overview,逐步推一整条线

这种"3 工位分立"导致 clarify / design / execute 三个心智割裂,无法形成一个"看完且推进一个工作项"的连贯体验。

## Solution

引入第三种核心实体 **TaskCard** + 新 section **BOARD**,在 Requirement 之下 1 层提供端到端产品:

- **看板视图** `/requirements/[id]/board/` —— 5 列(backlog / todo / in_progress / in_review / done)按 status 字段分组,每张卡片可点击进入详情页
- **详情视图** `/requirements/[id]/board/[cardId]/` —— 左主区(2/3)含字段 chips + content + 子任务 + 依赖;**右栏 toggle 双态**(默认态 = 属性表;展开态 = AI 协作 transcript,展开时属性隐藏)
- 同步退役 clarifying / designing / executing 三工位 + 整套 zones 注册表(`ZONE_META`、`ZoneRegistry`、`~/.aidevspace/zones/*.yaml`、`ZoneConfig` schema)
- 产物:**5 份 ADR(0024-0028)已锁定 + 3 个 HTML 原型已落 `docs/design/pages/` + 新立真实 Next.js page / 组件 / 服务 / 测试**

不动:**`ClaudeCodeProvider` / `runAnalysisQuery` 路径**(ADR-0023 守门 zero-touch);Run 入口仍在父 analyzing section。

## User Stories

### 看板页(`/board/`)

1. As a 需求 owner, 我想在 Requirement 详情页打开 Board section, so that 我能在 5 列(Backlog / Todo / In Progress / In Review / Done)里一览所有子卡的推进状态
2. As a 需求 owner, 我想在每列顶部看到该列卡片数, so that 我能一眼判断 backlog 是否需要清
3. As a 需求 owner, 我想在 board 顶部有过滤 chips(全部 / 我的 / 高优先级 / PRD 拆), so that 我能聚焦重点
4. As a 需求 owner, 我想点顶部 `[+ 从 PRD 拆]` 按钮, so that 我能触发 PRD 智能拆分(走父 analyzing transcript 跑 Run,产物落 `analysis/proposals/<run-id>/cards.yaml`)
5. As a 需求 owner, 我想 Run 完成后 board 顶部出现"建议卡片组 N 条 [载入到看板]"按钮, so that 我能看到 AI 提案
6. As a 需求 owner, 我想在载入建议卡片组时勾选 / 编辑 / 删除单卡, so that 我能保留对自己有用的
7. As a 需求 owner, 我想点 `[全部确认]` 一次性落盘建议卡片, so that 我省去逐张手动确认(`source='prd_split'`)
8. As a 需求 owner, 我想点 board 上某张卡片, so that 我能进入详情页 `/board/[cardId]/`
9. As a 需求 owner, 我想 5 列的头部如果与父 Requirement.status 对齐冲突,显示红色 ⚠, so that 我知道哪一列与父级不一致
10. As a 需求 owner, 我想点列头部 ⚠ 弹出 Modal(强制切换 / 先调整子卡 / 取消), so that 我能选择 override 行为

### 卡片形态(图 1)

11. As a 需求 owner, 我想在 board 上看图 1 形态卡片(短 ID + title 2 行 + 内容摘要 2 行 + 优先级 badge + 头像 + source 小标 + labels), so that 一眼能定位
12. As a 需求 owner, 我想卡片底部显示 assignee 头像(可选,无则"+"占位), so that 我能看出谁负责
13. As a 需求 owner, 我想卡片底部有 priority badge(low / medium / high / urgent / 无), so that 一眼看出优先级
14. As a 需求 owner, 我想卡片底部 source 小标(PRD 拆 / 子拆 / 手动), so that 我能追溯卡片来源

### 详情页主区(`/board/[cardId]/` 默认态)

15. As a 需求 owner, 我想详情页顶部 task-title row(id + title + archive/more 按钮), so that 我能看清标题
16. As a 需求 owner, 我想顶部 6 项 chip 行(状态 / 优先级 / 来源 / 负责人 / 创建 / 更新), so that 我能一眼掌握卡片核心字段
17. As a 需求 owner, 我想点 chip 下拉修改, so that 我能快速推进卡片 status / priority / assignee
18. As a 需求 owner, 我想在主区看到父 Requirement 进度条(子卡 done / 总卡比), so that 我知道这个需求走到哪了
19. As a 需求 owner, 我想在主区看到 Markdown 渲染的 Content, so that 我能直接读卡片描述
20. As a 需求 owner, 我想在主区底部看到子任务列表(若有 parent_id 指向当前), so that 我能展开这张粗卡片对应的子卡
21. As a 需求 owner, 我想在主区底部看到依赖卡列表(depends_on), so that 我能看出被哪些前置任务阻塞
22. As a 需求 owner, 我想点主区底部 `详细信息 ▾` 折叠块, so that 我能看到剩余 8 项冷字段(id 全称 / parent_id / labels / order_index / depends_on / is_archived / completed_at / 创建于 由 Run #XX)

### 详情页右栏 toggle 双态

23. As a 需求 owner, 我想在右栏默认看到属性表(图 2 飞书任务页形态), so that 我能改字段不离开主区
24. As a 需求 owner, 我想右栏属性表 8 项每项均支持下拉修改, so that 我能在属性内闭环操作
25. As a 需求 owner, 我想右栏默认态顶部有 `[💬 在对话中打开]` 按钮, so that 我能按需召唤 AI 协作(不主动出现)
26. As a 需求 owner, 我想点 `[💬 在对话中打开]` 后右栏完全切到 transcript 视图, so that 我能专注对话
27. As a 需求 owner, 我想在展开态看到 transcript 消息流 + 底部输入框, so that 我能继续对话
28. As a 需求 owner, 我想展开态右栏底部**没有** `[开始 Run]` 按钮(对比 analyzing section), so that 我清楚"沟通 ≠ 执行",Run 仍走父 analyzing
29. As a 需求 owner, 我想展开态右栏顶部有 `[✕]` 收起按钮, so that 我能切回属性表
30. As a 需求 owner, 我希望 **toggle 状态不持久化** —— 每次进入 board 详情页从属性表开始, so that 符合"克制,在场"哲学

### AI 协作 transcript(展开态)

31. As a 需求 owner, 我想 transcript 派生父 analyzing.transcript 最近 K 条(K=10)作为初始上下文, so that 我不用复述全局 PRD
32. As a 需求 owner, 我想 transcript 输入框用 `#[id]` 引用父 analyzing Run 产物, so that 我能在 TaskCard 对话中带出父上下文
33. As a 需求 owner, 我想 transcript 引用 PRD 段落(`prd §2.3`)只读 link, so that AI 协作有规可循
34. As a 需求 owner, 我想 transcript `Send` 快捷键 Cmd+Enter, so that 我能快速发消息
35. As a 需求 owner, 我想 transcript 写入落 `~/.aidevspace/requirements/<id>/board/tasks/<cardId>/transcript.yaml`, so that 它物理隔离父 analyzing transcript

### 父子 status 互锁(强约束)

36. As a 需求 owner, 我想父 Requirement.status 从任意态切到 `implementing`,软校验子卡无 backlog,如果不满足弹 Modal 让我选「强制切换 / 先调整子卡 / 取消」, so that 我不会丢数据
37. As a 需求 owner, 我想父 status 切到 `submitting`,软校验子卡无 in_progress,弹 Modal 同上
38. As a 需求 owner, 我想父 status 切到 `done`,软校验所有非 archived 子卡 status='done',弹 Modal 同上
39. As a 需求 owner, 我希望选「强制切换」时, override 写 `board/overrides.log`, so that 产品层可审计
40. As a 需求 owner, 我想当所有非 archived 子卡 status='done' 时,Requirement Overview 顶部显示「建议切父 status 到 done」提示, so that 我能主动升级父级(只提示不自动)

### 手势与命令

41. As a 需求 owner, 我想 Cmd+K 命令面板搜"MUL-12"能跨页跳转, so that 我能用快捷键切换 board 卡片
42. As a 需求 owner, 我想点 board 卡片菜单(⋯)能 archive / change priority / change assignee, so that 我能在卡片层做日常管理
43. As a 需求 owner, 我想 board 列头部有 `[+]` 按钮在该列快速创建 manual 卡(`source='manual'`, `parent_id=Requirement.id`), so that 我能 0 摩擦建卡
44. As a 需求 owner, 我想 board `[+ 新任务]` 按钮弹 modal 让我填 title / content / priority / assignee / status, so that 我能精细建卡
45. As a 需求 owner, 我想 board 顶部 `[自动归档 N]`(本期不做 UI 操作,但 backend 标记), so that 我能批量把 done > 7 天的卡片 is_archived = true(本期预留,UI 后置)

## Implementation Decisions

> 字段定义、数据基线、所有 spec 级决策已在 5 份 ADR(0024-0028)+ Round 2 UI 决议里 lock。本节列实施时**不二次决策**的范围。

### 数据基线
- TaskCard 字段集 13 项(id / parent_id / status / title / content / priority / assignee / labels / depends_on / order_index / source / is_archived / created_at / updated_at / completed_at)严格按 ADR-0024 D1
- 字段必填/可空严格按 ADR-0024 D5
- 物理路径:`~/.aidevspace/requirements/<id>/board/tasks/<ulid>.json` + `<ulid>/transcript.yaml`
- 数据模型落 `packages/shared/src/task-card.ts`(Zod schema)
- 父子 status 互锁规则:implementing 需无 backlog;submitting 需无 in_progress;done 需全部 done;override 写 `board/overrides.log`

### 服务层(agent 端,新增文件)
- `apps/agent/src/services/board/TaskCardStore.ts` —— CRUD + 列表 + 软删
- `apps/agent/src/services/board/TaskCardTranscript.ts` —— transcript 读写 + 派生 snapshot(K=10)
- `apps/agent/src/services/board/StatusConstraintGuard.ts` —— 实施 D2 软约束 3 条
- `apps/agent/src/services/board/OverrideLog.ts` —— append-only
- `apps/agent/src/services/board/PrdSplitService.ts` —— Run 触发 + 产物落 `analysis/proposals/<run-id>/cards.yaml`
- `apps/agent/src/services/board/TranscriptRefParser.ts` —— `#[id]` 引用解析
- 全部按 ADR-0024 / 0027 / 0028 描述实现

### API 路由(agent 端)
- `GET /api/requirement/:id/board/cards`
- `GET /api/requirement/:id/board/cards/:cardId`
- `POST /api/requirement/:id/board/cards`(manual 创建,`source='manual'`)
- `PATCH /api/requirement/:id/board/cards/:cardId`
- `PATCH /api/requirement/:id/board/cards/:cardId/status`
- `POST /api/requirement/:id/board/cards/:cardId/archive`
- `POST /api/requirement/:id/board/split-from-prd`(PRD 拆解)

### Web 路由层(新增 / 修改 / 退役)
- 新增 `/requirements/[id]/board/` ← `<BoardSection>`
- 新增 `/requirements/[id]/board/[cardId]/` ← `<BoardCardDetailPage>`
- 退役 `apps/web/src/app/(workspace)/requirements/[id]/[zone]/{clarifying,designing,executing}/`
- 改造 `/requirements/[id]/[zone]/page.tsx` switch-case 6 → 4(drafting / board / analyzing / wrapup)
- 改造 `generateStaticParams` 用 `REQUIREMENT_SECTIONS.map`

### Web 组件层(新增 / 改造 / 退役)
- 新增 `BoardSection.tsx` / `Column.tsx` / `Card.tsx`
- 新增 `CardDetail.tsx`(主区 2/3)
- 新增 `CardTranscriptPanel.tsx`(右栏 toggle 展开态)
- 新增 `CardTranscriptInput.tsx`(输入框 + # 引用 + ⌘+Enter)
- 新增 `StatusConstraintModal.tsx`(冲突 override 三选项 modal)
- 新增 `SplitFromPrdModal.tsx`(PRD 拆解)
- 新增 `NewTaskModal.tsx`(manual 创建)
- 改造 `zone-bar.tsx`(6 Tab → 4 Tab)
- 改造 `command-palette.tsx`(工位搜索 6 → 4)
- 退役 `clarifying-zone.tsx` / `designing-zone.tsx` / `executing-zone.tsx`

### UI 视觉(严格对照 3 个 HTML 原型)
- **5 列状态颜色方案 A**:`backlog #94a3b8` / `todo #cbd5e1 空心` / `in_progress #f59e0b` / `in_review #16a34a` / `done #3b82f6`;列名文字色 + 列背景 tint 严格对应(详见 `board-color-options.html`)
- **卡片密度中等 112-120px** —— id + title 2 行 + summary 2 行 + meta 双行
- **详情页 field chips** = 顶部 6 chip + 「详细信息 ▾」折叠(详见 `board-detail-field-chips.html`)
- **详情页右栏 toggle 双态** = 默认属性表(图 2 key-value 形态)+ `[💬 在对话中打开]` / 展开 head + 消息流 + 输入框 + `[✕]`(详见 `board-detail-final.html`)
- **toggle 不持久化**(沿用 ADR-0022 D4.4)
- 看板 toolbar = 左视图切换 `[REF-XX Board ▾]` + 中过滤 chips(全部/我的/高优先级/PRD 拆)+ 右 `[+ 新任务] [+ 从 PRD 拆]` 双按钮(Filter/Display 全走 Cmd+K)

### 设计 tokens(沿用决策 22 + Round 2)
- 品牌主色:`--brand: #5e6ad2` 全 6 阶
- 间距 4 倍数(4/8/12/16/20/24/32)
- 字号 9 档(11/12/13/14/16/18/20/24/32)
- 字体:Inter + JetBrains Mono(短 ID 用 mono)
- 圆角:sm 4 / md 6 / lg 8 / xl 12
- 阴影:sm / md / lg 三档

### 守门(ADR-0023 zero-touch 强化)
- `ClaudeCodeProvider` / `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter` 全套**不动**
- 即使 Board 详情 toggle 出 transcript,Run 路径仍走父 analyzing,**不挂 Run**
- 实施期间 board 详情任何尝试发 Run → 先在 `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 加 RED 测试,GREEN 才合入

### 退役事项
- 删除 6 份 YAML `~/.aidevspace/zones/*.yaml` 一次性清理 hook(agent startup,idempotent)
- 删除 11 个 web 文件:`zones.ts`(改名 `sections.ts`)、3 zone 组件、5 数据加载 + 2 测试批次
- ripgrep 全文扫残留 `clarifying|designing|executing` 仅允许注释 / ADR 引用 / 决策表

### State machine(原 `board-detail-final.html` §3 inline)

> 以下 snippet 来自原型 `board-detail-final.html` §3,编码右栏 toggle 行为语义,实施时严格保留:

```
state = 'property'               // 默认,用户进入详情页
right_column = ['💬 在对话中打开', 属性表, 关系, 创建/更新]
ai_button = <button onClick={toggle}>在对话中打开</button>

function toggle() {
  state = state === 'property' ? 'transcript' : 'property'
  // 不持久化,符合 ADR-0022 D4.4 + 决策 24 克制在场
  localStorage.removeItem('board-card-side-state')
}

// transcript 态
state = 'transcript'
right_column = [head(badge '物理独立·仅描述' + ✕), msgs, input(⌘+Enter)]
transcript.path = ~/.aidevspace/requirements/<id>/board/tasks/<cardId>/transcript.yaml
transcript.scope = 仅描述 / 不发 Run  (ADR-0028 D2)
initial_context = parent_analyzing.transcript 派生 snapshot (K=10)
```

## Testing Decisions

- **数据层**:`packages/shared/src/__tests__/task-card.test.ts` —— Zod schema 正反例、源枚举 / 5 态 / priority / 父子联动边界
- **服务层**:`apps/agent/src/__tests__/board/{task-card-store,status-constraint-guard,prd-split-service,transcript-ref-parser}.test.ts`
- **组件层**:`apps/web/src/__tests__/board/{board-section,column,card,card-detail,card-transcript-panel,status-constraint-modal}.test.tsx`
- **e2e**(playwright):`apps/web/e2e/board.spec.ts`
  - 创建 Requirement → PRD 起草 → 切 board → `[+ 从 PRD 拆]` 触发 Run → 确认 3 张粗卡片
  - 点卡片进详情 → transcript 输入 → 验证 `[开始 Run]` 按钮不存在(对照 analyzing section)
  - 右栏默认属性表 → 点 `[💬 在对话中打开]` → 切 transcript → 点 `[✕]` → 切回属性表
  - 父切 implementing + 子有 backlog → Modal 三选项验证
  - board 列 ⚠ 头部 → 弹出冲突信号 → 跳转父详情
- **守门测试**:`apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 必须保 **GREEN**(即使本期不动 Provider,作为 weekly 强约束)
- **视觉对照基准**(不写自动化视觉测试,改由手工对照):
  - `docs/design/pages/board-color-options.html` ← 5 列色
  - `docs/design/pages/board-detail-field-chips.html` ← field chips
  - `docs/design/pages/board-detail-final.html` ← toggle
- **静态检查**:`pnpm typecheck` 全包 / `pnpm lint` GREEN / `git grep -n 'clarifying\|designing\|executing'` 仅命中**注释 / ADR cross-ref / 决策表**

## Out of Scope

- **board 拖拽重排**(`order_index` 算法):本期不支持,UI 不渲染拖拽手柄
- **跨 Requirement 聚合看板**(workspace 级总看板):留 P1+
- **board 详情 transcript 走 Run**:违反 ADR-0028 D2,需新立 ADR 才能合入
- **`plan/tasks.md` 与 TaskCard 迁移**(`executing` 退役时是否把现有 `plan/tasks.md` 导入 TaskCard):留 v1.0.7+ 单独 ADR 决定
- **`board 自动归档 N 天规则`具体配置项**:本期后置 impl 阶段
- **移动端 / 响应式 < 1280px**:本期仅桌面端,响应式留 impl
- **多用户协作 / 云端 SaaS**:不引入
- **新 HTML 原型**:本期 3 个已落,后续 Round 再加

## Further Notes

- **ADR 现状**:5 份 Round 1(0024-0028)+ Round 2 改动(0027 D5 toggle / 0028 D5 补注),决策已 `accepted`
- **HTML 原型现状**:`docs/design/pages/board-{color-options,detail-field-chips,detail-final}.html`,3 个文件已 attach 截图经 user review
- **落地顺序参考**(Round 1 末尾「出落地清单」):
  1. Phase 1 数据模型(packages/shared) → 1 个 PR
  2. Phase 5 数据加载底座(web lib) → 1 个 PR
  3. Phase 2 agent 服务(boards/ + API)→ 1 个 PR
  4. Phase 3 web 路由(board pages + 退役 3 个)→ 1 个 PR
  5. Phase 4 web 组件(board + detail + transcript + modal)→ 1 个 PR
  6. Phase 6 测试守门 + Phase 7 迁移 + Phase 8 demo → 1 个 PR
- 7 个 PR 顺序串行可,部分并行需权限评审
- **风险点**:zones yaml 一次性清理(idempotent),老用户升级时勿中断;`StatusConstraintGuard` 是新增主路径,需充分单测
- **进一步**:落地完成后建议 `git tag v1.0.7` + 在 settings.json 标注 board section 启用 feature flag
