---
status: accepted
updated: 2026-08-06 · D5 toggle 双态改写(右抽屉 transcript → 右栏 toggle: 默认属性 / 展开 transcript)
---

# board section 引入 + 3 工位退出范围 + PRD 拆解工作流(ADR-0027)

[ADR-0024](0024-taskcard-card-model.md) 定义了 TaskCard 实体;[ADR-0026](0026-zones-registry-retirement.md) 把 zones 注册表退役,改为 4 section hardcode。本 ADR 在此之上,确定 **board section** 的引入 + **clarifying / designing / executing 三工位退出** + **PRD → 粗卡片拆解工作流** 三件事的边界。

## 背景与现象

### 用户原话(12 轮 grilling 烤)

> 「全面放弃现有的 clarifying、designing、executing 工位设计,转而用任务看板页面替代」

烤过 12 轮后:
- 卡片 ⊂ Requirement(包含,非替代)
- 看板页 = 5 列(backlog / todo / in_progress / in_review / done),用户拖拽 / 点按钮维护
- 任务详情(子路由全屏)承载 "AI 沟通 / 补充上下文 / 分析 / 澄清细节"

### 三工位的旧职责 vs 替代映射

| 旧工位 | 旧职责 | 替代映射 |
|---|---|---|
| **clarifying** | 需求澄清 Q&A 线程 + `clarifications.yaml` | **不再独立页面**;clarification 落到 TaskCard.transcript / board 的 comment thread |
| **designing** | 评审候选方案 + `design/` 产物 | **不再独立页面**;设计文档落 `design/` 目录不再新建,部分由 analyzing 跑 Run 间接产生 |
| **executing** | 监督 AI 实施 + `plan/tasks.md` + 多 Agent 协作 | **不再独立页面**;实施推进由 board section 的 TaskCard 5 态推进 + 父 Requirement.status 联动 + 走父 analyzing transcript 跑 Run |

### 烤时的边界决策

- **board 路由** = `/requirements/[id]/board/`(与 `/drafting/` `/analyzing/` `/wrapup/` 平级)
- **board 详情** = `/requirements/[id]/board/[cardId]/`(子路由全屏,详情页结构见图 2)
- **PRD → 粗卡片拆解** = 从 board "+" 按钮触发(Run 仍走父 analyzing transcript,产物 AI proposal,确认后落 `board/tasks/`)

## 决策

### D1. 退出 3 工位的范围

| 旧工位 | 哪些**物理 artifact** 退役 | 哪些**功能**吸收到 board |
|---|---|---|
| **clarifying** | route `/requirements/[id]/clarifying/` 退役;<br>`clarifying-zone.tsx` 组件退役;<br>`clarifying.ts` server 数据加载退役 | clarification 对话功能 = TaskCard 详情 transcript(物理独立,见 ADR-0028) |
| **designing** | route `/requirements/[id]/designing/` 退役;<br>`designing-zone.tsx` 退役;<br>`designing.server.ts` / `designing.ts` 退役 | 候选方案讨论 = 在父 analyzing transcript 跑 Run(产物落 `analysis/`),不专门占 page |
| **executing** | route `/requirements/[id]/executing/` 退役;<br>`executing-zone.tsx` 退役;<br>`executing.ts` + `useExecutingSse.ts` 退役;<br>`executing.test.ts` / `designing.server.test.ts` 退役 | AI 实施推进 = board 5 态推进(用户/agent 拖卡片);`<PlanTasksView>` 等专用组件退役,`plan/tasks.md` 内容由 board 5 列取代 |

**保留范围**(`drafting` / `analyzing` / `wrapup`):

- 这 3 个工位的 route + UI + 数据加载 + 测试**全部保留**,但元信息从 `ZONE_META` 迁到 `SECTION_META`([ADR-0026](0026-zones-registry-retirement.md))
- `analyzing` Section 比 D1 中退役的 3 个工位**保留的核心差异**:它是 **Analysis Run 的发起载体**(决策 58-66, ADR-0013 / ADR-0021),board 不复用此能力

### D2. board section 进入 section 集合(详见 ADR-0026 D2)

`REQUIREMENT_SECTIONS` = `['drafting', 'board', 'analyzing', 'wrapup']`

`SECTION_META.board` 字段集:

```typescript
board: {
  label: 'BOARD',
  icon: '📋',
  statusColor: 'blue',       // 与 drafting(灰)/ analyzing(紫)/ wrapup(绿)区分
  hasResourceTree: false,    // board 不需要资源树(看板是任务全景,不是文档树)
  hasInlineRail: false,      // board 不需要 inline AI 栏(协作走详情页右侧抽屉,见 ADR-0028)
  description: '任务看板 · 5 列工作项推进',
  defaultArming: [/* todo decision-pending in impl */]
}
```

`board` 在 Next.js 路由层 = `[zone]/page.tsx` 多 case 之一,组件 `<BoardSection>` 全屏渲染(见 D3)。

### D3. board section 5 列布局(图 1 形态)

- **5 列 = 严格按 TaskCard.status 字段分组**:backlog / todo / in_progress / in_review / done
- 每列头部:N 计数 + 与父 `Requirement.status` 的对齐信号([ADR-0025](0025-parent-child-status-lock.md) D4)
- 卡片显示(图 1 形态):
  - 顶部 `id 短`(`<ulid>.slice(-4)`,8 位短哈希以可读)
  - 标题(2 行)
  - content 首 80 字摘要
  - 优先级 badge(low / medium / high / urgent / 无)
  - source 小标(`PRD 拆` / `子拆` / `手动`)
  - 底部左 = assignee 头像(8px)+ 标签 chip(若有);底部右 = `more` 按钮
- 看板顶部 toolbar:
  - 左:`+ 新任务`(manual)、`+ 从 PRD 拆`(prd_split,见 D4)
  - 中:过滤器(priority / assignee / label / source)
  - 右:`自动归档 N` 按钮(批量把 status='done' && 完成 > 7 天 的卡片设 `is_archived = true`)
- 拖拽行为(本期不做,留 P1+):本期只接受"点 + / 选状态"两步操作推进卡片;`order_index` 默认 null(列尾追加)

### D4. PRD → 粗卡片拆解工作流(board 触发)

**触发点** = `board` 顶部 toolbar `[+ 从 PRD 拆]` 按钮 → Modal:

```
┌─ 从 PRD 拆为卡片 ────────────────────┐
│ 拆分粒度: [粗 ●] [中 ○] [细 ○]        │
│ 期望卡片数: [5] [推荐]                │
│ 限定上下文: ☑ PRD   ☐ 关联仓库 ☐ ... │
│                [取消]    [开始拆分 →] │
└────────────────────────────────────────┘
```

**发起链路**:

1. modal `[开始拆分]` → 创建一次性 Run(`useAnalyzingRunner.transient(...)
   ```
   触发 transcript = 当前父 Requirement.analyzing.transcript(最后 N 条作为上下文)
   prompt = 「基于以下 PRD + 之前对话上下文,拆为 N 张粗卡片草稿」
   ```)
2. Run 跑在父 `analyzing` transcript 内,**产物落 `~/.aidevspace/requirements/<req-id>/analysis/proposals/<run-id>/cards.yaml`**
3. board UI 显示 Run 状态(progress + 当前 thinking),底部 AI 思考条按 ADR-0022 浮动显示
4. Run 完成后:board 顶部出现 `建议卡片组 N 条 [载入到看板]` 按钮 → 点开 modal
5. modal 显示每张候选卡片(title + content + suggested status='backlog' + suggested priority),用户:
   - 可勾选 / 取消 / 编辑 / 删除单卡
   - 可点 `[全部确认]` 全部落盘
6. 用户确认 → 对每张 `source='prd_split'` 写入 `board/tasks/<new-ulid>.json`;Run 触发方拥有 override status / priority 的最终权

**关联**:

- Run 路径完全沿用 [ADR-0021](0021-analyzing-skill-driven-analysis-runs.md) + [ADR-0023](0023-mcp-server-path-coverage.md),**不动 ClaudeCodeProvider 实现**
- 仅在 agent service 加一条路由:`POST /api/requirement/:id/board/split-from-prd` 接受 modal payload,内部调用现有 `runAnalysisQuery` + 新增 prompt assembler `prd-split-cards`

### D5. 卡片详情路由与结构(子路由全屏,右栏 toggle 双态)

> v1.0.7 改写:原"D5 卡片详情右抽屉 = transcript 默认显示"改为"右栏 toggle,默认态 = 属性表(图 2 形态),展开态 = transcript,展开时属性表隐藏"。理由:产品更贴近图 2 飞书任务详情页用户心智,符合决策 24「克制,在场」。Run 路径不动(详见 [ADR-0028](0028-taskcard-transcript-independence.md) D2)。

- URL:`/requirements/[id]/board/[cardId]/`
- page component `<BoardCardDetailPage>`(在 `apps/web/src/app/(workspace)/requirements/[id]/board/[cardId]/page.tsx`)
- 详情页布局 **左主区 2/3 + 右栏 1/3 toggle 双态**

#### D5.1 默认态(右栏 = 属性表 + AI 按钮,无 AI 推送)

```
┌─────────────────────────────────────────────────────────────┐
│ StatusBar(breadcrumb / ⌘+Enter 提示 / AI 状态)                │
├─────────────────────────────────────────────────────────────┤
│ Crumb: REF-100 · Board / MUL-12 · ...                         │
├─────────────────────────────────────┬───────────────────────┤
│ 1. 主区(2/3)                         │ 2. 右栏(1/3) 默认态    │
│  - task-title row:                   │  - [💬 在对话中打开]    │
│    id + title + archive/more         │    toggle 按钮(顶部)    │
│  - 顶部 chip 行(6 项热字段):        │  - 属性表(图 2 key-    │
│    status / priority / source /      │    value 行,8 项):     │
│    assignee / 创建 / 更新            │    状态 / 优先级 /      │
│  - 父 Requirement 进度条             │    负责人 / 标签 /      │
│  - Content Markdown 块                │    工作流 / 开发上下文 / │
│  - 子任务列表                        │    截止日期 / 重复      │
│  - 依赖卡列表                        │  - 关系区(阻塞于 / 阻塞 │
│                                     │    / 相关议题)          │
│                                     │  - 创建于 / 更新于      │
├─────────────────────────────────────┴───────────────────────┤
│ 底部 AI 思考条(全局,需求级状态)                              │
└─────────────────────────────────────────────────────────────┘
```

- 主区宽度比 = 2:1(类 [ADR-0017](0017-analyzing-main-document-reader.md) D1)
- 右栏属性表 8 字段每项均支持下拉修改(图 2 飞书任务页形态)
- 「在对话中打开」按钮点击后右栏切换到 D5.2 展开态
- **右栏不显示 AI transcript / 不发 Run**(默认态保持克制,决策 24)
- 详情页有「回到 board」面包屑、archive / delete 按钮(主区 task-title row 右侧)

#### D5.2 展开态(右栏 = transcript,属性隐藏)

点击「在对话中打开」按钮后:

- 右栏 head:`💬 AI 协作 · MUL-12 transcript` + 物理独立 badge + `✕` 收起按钮
- 右栏中部:**消息流**(用户 / 助手交替,带 ref 引用 `#<run-id>`)
- 右栏底部:**输入框**(textarea + 📎 引用 Run + `[发送] ⌘+↵`)
- **属性表不可见** —— 展开 transcript 时属性折叠,要让属性再显需点 `✕` 收起
- transcript 内容严格按 [ADR-0028](0028-taskcard-transcript-independence.md) D5:仅描述、不可发 Run、可引用父 Run 产物但 Run 仍走父 analyzing

#### D5.3 toggle 行为

- **按钮位置**:右栏顶部(默认态 = `[💬 在对话中打开]` / 展开态 = `[✕]`)
- **状态不持久化**:每次进入详情页从属性表开始,沿用 [ADR-0022](0022-analyzing-history-floating-action-button.md) D4.4 决策(决策 24「克制,在场」)
- **状态切换不改变 URL**,无需新立 page (URL 始终是 `/board/[cardId]/`)
- 切换动画:右栏内容 fade-in + 8px right-slide(~250ms,与 ADR-0022 D4.4 一致)

#### D5.4 与原 D5 的差异(对比)

| 维度 | v1.0.6 原 D5 | v1.0.7 现 D5 |
|---|---|---|
| 右栏默认内容 | transcript | 属性表 + AI 按钮 |
| transcript 触发 | 默认显示 | 默认收起,按钮触发 |
| 属性常驻 | 否(进 transcript 后消失) | 是(默认态常驻,展开 transcript 暂藏) |
| Run 路径 | 不挂 Run(沿用 ADR-0028 D2) | 不挂 Run(沿用 ADR-0028 D2)— **不变** |
| 详情 URL | `/board/[cardId]/` | `/board/[cardId]/` — **不变** |
| 主区布局 | 2:1 | 2:1 — **不变** |

### D6. 9 个不再使用的 UI 文件 / 数据文件

实施阶段一并删除:

- `apps/web/src/app/(workspace)/requirements/[id]/[zone]/clarifying/page.tsx`(下两同)
- 同上 `designing/page.tsx`、`executing/page.tsx`
- `apps/web/src/components/clarifying-zone.tsx`、`designing-zone.tsx`、`executing-zone.tsx`
- `apps/web/src/lib/clarifying.ts`、`designing.ts`、`designing.server.ts`、`executing.ts`、`useExecutingSse.ts`
- 测试:`apps/web/src/__tests__/{clarifying,designing,executing}-zone.test.tsx`、`executing.test.ts`、`designing.server.test.ts`

(实施时 ripgrep 全仓扫"`clarifying`/`designing`/`executing`" 字符串,逐一清理)

## 不在范围内

- **board 拖拽**(`order_index` 重排) → 本期不支持,UI 不渲染拖拽手柄
- **跨 Requirement 聚合看板**(workspace 级总看板) → 留 P1+
- **board 详情 transcript 走 Run** → 见 [ADR-0028](0028-taskcard-transcript-independence.md) D2 约束
- **board 详情页 UI** 的具体设计稿(typography / spacing / chip 形态) → 留 impl 阶段,本期先以图 2 形态为准
- **board 自动归档** (D3 中 N 天规则) → D3 已包含,但具体天数配置项留 impl 阶段
- **`plan/tasks.md` 与 TaskCard 的迁移**(`executing` 退役时 `plan/tasks.md` 是否导入为 TaskCard) → 本期不动,在 v1.0.7 单独 ADR 决定

## 主要取舍

- **选择「3 工位全部退役,功能吸收到 board」而不是「保留 1-2 个工位作为 fallback」**:保留会让用户认知模型分裂("用 board 还是用 clarifying?"),且 3 个工位的核心功能(transcript / Run)已在 board section 表达
- **选择「PRD 拆解发起在 board,Run 走父 analyzing」而不是「PRD 拆解完全在 analyzing」**:前者让用户工作流不离开 board(常见场景:用户在 board 看到 backlog 列有 N 张粗卡片,想再加几张 → 一键触发),后者会强制用户切走
- **选择「board 详情页 = 不可发 Run 的 transcript 视图」而不是「详情页内嵌 Run 触发」**:前者在 UI 上清晰分隔"沟通 / 执行";后者会引发 ADR-0023 守门检查(mcpCallCounter 等需重做)。见 [ADR-0028](0028-taskcard-transcript-independence.md) 详述
- **选择「PRD 拆解产出**落 `analysis/proposals/<run-id>/`**而不是「落 `board/drafts/`」**:前者 Run 产物路径与现有 Run 模式一致(决策 2「目录即真相」+ ADR-0021),后者引入新路径

## 关联

- **上游**:
  - [ADR-0024](0024-taskcard-card-model.md) TaskCard 实体 = board 的物质基础
  - [ADR-0025](0025-parent-child-status-lock.md) 父子互锁规则 = board 5 列对齐信号的依据
  - [ADR-0026](0026-zones-registry-retirement.md) 4 section hardcode = board 进入 section 集合的格式
- **下游**:
  - [ADR-0028](0028-taskcard-transcript-independence.md) 详情页右侧抽屉 transcript 模型
- **关联继续生效**(不退役):
  - [ADR-0017](0017-analyzing-main-document-reader.md) 2:1 布局 → board 详情页复用
  - [ADR-0021](0021-analyzing-skill-driven-analysis-runs.md) + [ADR-0022](0022-analyzing-history-floating-action-button.md) → PRD 拆解 Run 走 analyzing
  - [ADR-0023](0023-mcp-server-path-coverage.md) → Run 路径守门不变
- **实现位置**:
  - 详情页:`apps/web/src/app/(workspace)/requirements/[id]/board/[cardId]/page.tsx`(新增)
  - 看板页:`apps/web/src/app/(workspace)/requirements/[id]/board/page.tsx`(新增)
  - 5 列渲染:`apps/web/src/components/board/{BoardSection,Column,Card}.tsx`(新增)
  - PRD 拆解 modal:`apps/web/src/components/board/SplitFromPrdModal.tsx`(新增)
  - agent 端:`apps/agent/src/services/board/{TaskCardStore,PrdSplitService}.ts`(新增)
