---
status: accepted
---

# TaskCard 卡片模型引入(ADR-0024)

12 轮 grilling 确认:clarifying / designing / executing 三工位的产品形态 ——「需求被拆分为多张卡片,每张卡片可独立推进」—— 不被现有 zones 注册表支持(没有工作项粒度的 UI 容器)。本 ADR 在保留 Requirement 工作台 7 形态不变的前提下,引入第三种核心实体 **TaskCard**,作为 Requirement 之下的**可独立推进的工作项**。

## 背景与现象

### 现有结构(烤之前)

- `Requirement`(需求) = `~/.aidevspace/requirements/<id>/` 下的完整需求项目,10 态 status(draft / drafting / analyzing / clarifying / designing / planning / implementing / submitting / done / archived)
- `Task`(任务) = 单数概念,`packages/shared/src` 与 `requirement.md` 章节都提到,但物理实现:任务的"载体"是 `plan/tasks.md`(markdown 文本),无独立 schema、无状态机、无看板 UI
- 6 工位 = DRAFTING / ANALYZING / CLARIFYING / DESIGNING / EXECUTING / WRAP-UP,每个为独立 route_segment + 独立 UI

### 痛点(烤时提出的)

用户在 12 轮 grilling 中逐步显化出"一个 PRD 拆出多个可独立推进的工作项"的工作流心智模型:

> 「一个需求的开发本身要经历多个步骤,如 draft / drafting / analyzing 等。但是在实际实施时并不是一次性完成的,一般会把需求按功能、按实现细节拆分成多个小的边界清晰的可以一次性完成的小任务,每个任务按依赖关系一个一个执行。」
>
> 「期间可随时增加任务到任务看板。」

这是一个与 zones 平行的心智模型 —— 用户的"需求"运行的是"流程阶段",用户的工作项运行的是"推进状态"。两条线交叉在 Requirement 之下、Zone 之外。当前 zones 注册表没能表达"工作项的独立推进"。

### 为什么不动 Requirement 解决

Requirement 是 **完整的业务需求项目**(一整个订单退款功能);TaskCard 是 **单个可独立完成的小任务**(写 refund-service 接口)。两者语义层级不同 —— 让 Requirement 承担"工作项"语义会让 Requirement 的 `meta.yaml` 数据形状剧烈膨胀(从 5 字段到 30+ 字段),与决策 2「数据存储 = 纯文件系统、目录即真相」冲突(目录中突然出现动态任务列表)。因此选择新建第三种实体。

## 决策

### D1. 新实体 TaskCard,数据基线

```
type TaskCard = {
  id: string                                     // ULID (如 '01J7X3K2P5EVR0Z3YQJD8HFKX9')
  parent_id: string | null                       // 指向 Requirement.id 或另一张 TaskCard.id(后者用于子拆)
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'  // 5 态,见 ADR-0025
  title: string                                  // 卡片标题(图 1 / 图 2 顶部)
  content: string                                // Markdown 卡片正文
  priority: 'low' | 'medium' | 'high' | 'urgent' | null
  assignee: string | null                        // user id(可选)
  labels: string[]                               // 自由 tag(图 1 卡片 badge 集合)
  depends_on: string[]                           // TaskCard.id[];UI 不渲染,后台调度用
  order_index: number | null                     // 看板列内排序;null 表示追加到列尾
  source: 'prd_split' | 'sub_split' | 'manual'   // 卡片来源(用于回溯创建路径)
  is_archived: boolean                           // 默认 false;true 后看板不显示
  created_at: string                             // ISO 8601
  updated_at: string                             // ISO 8601
  completed_at: string | null                    // status 切到 'done' 时写
}
```

数据模型位于 `packages/shared/src/task-card.ts`,Zod schema `TaskCardSchema` 强制校验。

### D2. 父子关系:父子包含(TaskCard ⊂ Requirement)

- `TaskCard.parent_id` 为 **null** 时,卡片直属于父 Requirement(根级 TaskCard,通常是 PRD 拆出的粗卡片)
- `TaskCard.parent_id` 不为 null 时,值必须引用已存在的 TaskCard.id(子级 TaskCard,在父卡片详情里 AI 协作拆出)
- 这两种形态用同一字段表达同一语义("父任务 id"= 任何父节点),不分裂类型
- 跨 Requirement 的 TaskCard 不允许;`parent_id` 隐式归属当前 Requirement(`~/.aidevspace/requirements/<req-id>/board/tasks/<id>.json` 的 `<req-id>` 路径段就是归属)

### D3. 三种卡片来源(`source` 字段)

| 值 | 触发位置 | 落点 |
|---|---|---|
| `prd_split` | board section "+ 从 PRD 拆"按钮(详见 ADR-0027) | 走父 analyzing transcript → Run → 产物 → 落 `board/tasks/` |
| `sub_split` | 在某张父卡片详情里,AI 协作过程中提议拆出 | 同一父 analyzing transcript 之内,RUN 提产物 → 用户确认 → 落盘 |
| `manual` | board section "+" 按钮 或 详情页创建 | 直接写 `board/tasks/<id>.json`,`parent_id = Requirement.id` |

`source` 用于产品回溯(「这张卡片从哪儿来」),不影响 Status / 字段。同一卡片后续再编辑(改标题、接 transcript 协作)不重新写 `source`。

### D4. 物理存储

```
~/.aidevspace/requirements/<req-id>/board/
├── tasks/
│   ├── <ulid>.json                              # TaskCard
│   └── <ulid>/
│       └── transcript.yaml                       # 每 TaskCard 独立 transcript(详见 ADR-0028)
└── meta.yaml                                     # board section 的元数据(列宽、过滤器预设等)
```

- 单文件 `<ulid>.json` 落 TaskCard 全字段(含 Markdown content 内的换行,以 `\n` 转义或单字段 base64 二选一,默认 `\n` 转义)
- 独立 transcript 在 `<ulid>/transcript.yaml`(不嵌套在 `.json` 内,因为 transcript 体积可能大、需要更新而不重写主 JSON)
- 目录命名遵循决策 4「目录即真相」

### D5. 字段可空 vs 必填

| 字段 | 必填 | 默认 |
|---|---|---|
| id | ✅ | ULID 生成 |
| parent_id | ❌ | null(根级) |
| status | ✅ | 'backlog' |
| title | ✅ | (用户输入) |
| content | ❌ | '' |
| priority | ❌ | null(无优先级,UI 显示 `-` 灰标) |
| assignee | ❌ | null |
| labels | ❌ | [] |
| depends_on | ❌ | [] |
| order_index | ❌ | null(列尾追加) |
| source | ✅ | 'manual'(手工创建);prd_split / sub_split 由系统写 |
| is_archived | ❌ | false |
| created_at | ✅ | ISO now |
| updated_at | ✅ | ISO now |
| completed_at | ❌ | null |

### D6. 与现有 Task 概念(`plan/tasks.md`)的关系

`packages/shared/src/requirement.ts` 中的 "Task" 概念 ↔ 实现层 `plan/tasks.md` markdown 块(由 EXECUTING-zone 监督)**,**与 TaskCard **不重叠**:

- `plan/tasks.md` 是 **EXECUTING-zone 内部**的 AI 执行序列(agent 跑 plan 生成的步骤)
- TaskCard 是 **board section** 的工作项(人/Agent 协作的工作单位)
- 两者并存;TaskCard 不取代 `plan/tasks.md`,反之亦然
- 未来 EXECUTING-zone 退役时(本 ADR 范围之外), `plan/tasks.md` 也将跟着退役;但**当前不退**

### D7. UI 形态参考图

- 看板(图 1):5 列(backlog / todo / in_progress / in_review / done),每张卡片显示 `id (短) + title + content 摘要 + priority badge + assignee 头像 + labels + source 标识`
- 详情(图 2):左主区 = title / content / 字段表 / 子任务列表 / 进度条;右 320px 抽屉 = task transcript 续接 + AI 输入(详见 ADR-0027 + ADR-0028)

## 不在范围内

- 不在本 ADR 内决定:5 态 status 互锁规则 → [ADR-0025](0025-parent-child-status-lock.md)
- 不在本 ADR 内决定:zones 注册表如何退役 + section 硬编码 → [ADR-0026](0026-zones-registry-retirement.md)
- 不在本 ADR 内决定:board section 的 route_segment + 详情页结构 → [ADR-0027](0027-board-section-intro.md)
- 不在本 ADR 内决定:transcript 存储细节 → [ADR-0028](0028-taskcard-transcript-independence.md)
- 不在本 ADR 内决定:迁移策略(若 `plan/tasks.md` 中已有"任务"概念,是否导入为 TaskCard) — 见 D6,本 ADR 不动 EXECUTING-zone
- 不在本 ADR 内讨论:多需求跨板聚合看板(MVP 每个 Requirement 一个 board,跨 Requirement 聚合留 P1+)
- 不在本 ADR 内讨论:看板拖拽重排算法(order_index 算法在 implementation 阶段细化)

## 主要取舍

- **选择「新建 TaskCard 实体」而不是「扩展 Requirement meta.yaml」**:前者引入新物理路径与 schema,但清晰分离两条语义线;后者让 meta.yaml 体积增长到 30+ 字段,与决策 2「目录即真相」冲突(动态列表强制塞进单文件)
- **选择「ULID」而不是「`TASK-NN` 数字递增」**:前者全局唯一时间序,跨 Requirement 不冲突(尽管现状单板隔离);后者可读,但跨 Requirement 重号风险需自己处理
- **选择「单一 status 字段」而不是「Board status + 实际推进 status」双字段**:用户提出的 5 态语义明确,无歧义;双字段会引入"展示态与实际态不一致"的脏数据
- **选择「source 字段枚举 prd_split/sub_split/manual」而不是「inferred from parent_id」**:source 是产品回溯信号(用户看图 1 卡片 badge 想追溯来源),与 parent_id 的"包含关系"语义不同;两者并存

## 关联

- 上游:
  - [ADR-0011](0011-requirement-workbench-zone-adaptive.md) `Requirement 工作台 zone-adaptive` — 定义了 requirement 详情页 7 形态;本 ADR 在 board section 位置新增第 8 形态(原本 6 工位退役 3)
  - [ADR-0014](0014-status-soft-label-progress-derivation.md) — Requirement 10 态 status 软标签语义
- 下游:
  - [ADR-0025](0025-parent-child-status-lock.md) — D1 字段集里 `status` 字段的联动规则
  - [ADR-0027](0027-board-section-intro.md) — D7 UI 形态的 route_segment 与详情 URL
  - [ADR-0028](0028-taskcard-transcript-independence.md) — D4 物理存储的 transcript 子目录
- 实现位置:
  - 数据模型:`packages/shared/src/task-card.ts` (新增)
  - 存储路径:`apps/agent/src/services/board/TaskCardStore.ts`(新增)
  - Zod schema:`packages/shared/src/task-card.ts` 同文件 `TaskCardSchema`
  - 类型导出:`packages/shared/src/index.ts` 加 `export * from './task-card'`
