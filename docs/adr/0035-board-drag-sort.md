# ADR-0035: board section 拖拽重排 + 顺序算法(浮点中位)

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** 项目负责人
**Implements:** `.scratch/board-drag-sort/issues/01-drag-sort-end-to-end.md`
**关联 ADR:** [ADR-0024](0024-taskcard-card-model.md) D1 / [ADR-0027](0027-board-section-intro.md) D3 / [ADR-0025](0025-parent-child-status-lock.md) D2

---

## Context

[ADR-0027 D3](0027-board-section-intro.md) 明确推迟了「拖拽行为(本期不做,留 P1+)」:

> 「拖拽行为(本期不做,留 P1+):本期只接受"点 + / 选状态"两步操作推进卡片;`order_index` 默认 null(列尾追加)」

[ADR-0024 D1](0024-taskcard-card-model.md) 字段集 13 字段中已包含 `order_index: number | null`,但前端从未读写过。`TaskCardStore.list()` 按 `updated_at desc` 排序,完全忽略 `order_index`。

本期 7 轮 grilling 沉淀 D1-D7 解锁拖拽重排:**跨列 + 列内重排同时启用**。

### 用户原始诉求

> 「继续完善 board,实现卡片拖拽功能」

烤后的 7 项决策:

| 维度 | 决策 |
|---|---|
| 范围 | 跨列(改 status)+ 列内重排(改 order_index) |
| 顺序算法 | 浮点中位法 |
| 拖拽库 | @dnd-kit/core + @dnd-kit/sortable |
| 触发器 | 左侧 hover 才显 `⋮⋮` 6 点手柄 |
| 落盘策略 | 跨列拖悲观(等 Guard);列内重排乐观 |
| 父子互锁冲突 UI | 复用 `StatusConstraintModal` 三选项 |
| 详情页 order_index 展示 | 只读「列内位置 #N / M」 |

---

## Decisions

### D1. 拖拽范围 = 跨列 + 列内重排

- **跨列拖** = 改 `status`(5 态)+ 改 `order_index` 到目标列的目标位置
- **列内重排** = 仅改 `order_index`(`status` 不变)
- **列内排序** = `order_index asc, updated_at desc`(null 视为 ∞ = 列尾追加)

**落点**:
- 同列内重排 → `PATCH /board/cards/:cardId` body `{ order_index: x }`
- 跨列拖 → 先 `PATCH /board/cards/:cardId/status` body `{ status, override: false }`,
  落成功后(或 override 后)→ `PATCH /board/cards/:cardId` body `{ order_index: x }`

> 不选「仅跨列拖」(A):保留 `updated_at desc` 排序,拖完找不回位置,反心智。
> 不选「跨列 + 拖到指定位置」(C):drag preview 跨列出现插入线 = 本期范围外,
> 列为 v1.0.x 后续增量。

### D2. order_index 算法 = 浮点中位法

- 拖到前卡 `[prev]` 和后卡 `[next]` 之间 → `order_index = (prev + next) / 2`
- 拖到列头 = 与首个卡取中点 = `first.order_index / 2`(等差数列)
- 拖到列尾 = `last.order_index + 1`(等差 1)
- 列内全为 null → 第一张 `order_index = 1`,后续 `+ 1`
- **精度耗尽**:前后两卡距离 < 1e-6 → 触发整列批量重排
  (写入服务端,折半算法重写 `order_index = 1, 2, 3, ...N`)

**持久化字段不变** —— `TaskCardSchema.order_index: z.number().nullable`(已落 ADR-0024 D1,本期首次启用)。

**前端计算时机**:
- 拖拽手柄放下(`onDragEnd`)→ 立即算目标位置的中位值 → 乐观更新本地缓存
- 同列重排 → 立即 PATCH;跨列拖 → 先 PATCH /status,落盘后 PATCH /cardId(order_index)
- 乐观失败 → `onError` 还原 `queryClient.setQueryData` 缓存 + Toast

> 不选整数连续编号 B(每个 insert 触发整列重排,IO 放大,原子写难做)。
> 不选 LexoRank C(字符串理解门槛高,UX 损害)。
> 不选 timestamp D(毫秒冲突,同列尾追加退化)。

### D3. 拖拽库 = @dnd-kit/core + @dnd-kit/sortable

- `@dnd-kit/core` 5.x + `@dnd-kit/sortable` + `@dnd-kit/utilities`
- 关键 feature:`Sortable` preset + `SortableContext` + `useSortable` + `DragOverlay`
- 严格 a11y:键盘拖移 + `aria-roledescription` + focus 保持
- Apache 2.0,无协议顾虑
- 装入 `apps/web/package.json` 的 dependencies(tree-shake 小,核心 ~30 KB gz)

> 不选 Native HTML5(触摸差、a11y 需手写、移动端几乎不可用)。
> 不选 react-dnd(社区在迁出,HTML5 backend 为主)。
> 不选 framer-motion Reorder(跨列天然弱,包体 250 KB 违 Linear 紧凑)。

### D4. 触发器 = 左侧 hover 才显拖拽手柄

- Card 整体仍是 `cursor: pointer`(点击进详情,沿用 ADR-0027 D5)
- 左侧 `⋮⋮` 6 点 sprite,默认 `opacity: 0`,`group-hover:opacity-100`
- 仅手柄区域 `cursor: grab` / `cursor: grabbing`(拖拽中)
- 移动阈值 = 5px(由 @dnd-kit `PointerSensor` 默认 `activationConstraint.distance`)
- 移动 < 5px → 当点击进详情

> 不选整张可拖(与点击进详情冲突,ghost 遮挡菜单)。
> 不选始终显手柄(5 列 × N 卡片 = 视觉噪声,违 Linear 紧凑)。

### D5. 落盘策略 = 分级乐观 / 悲观

| 拖拽动作 | 调度 | 失败处理 |
|---|---|---|
| 跨列拖(改 status) | **悲观** · 走 `PATCH /status` · 等 Guard 回包 | 冲突 = `StatusConstraintModal` 三选项;落盘失败 = Toast + 回滚 + invalidate |
| 列内重排(改 order_index) | **乐观** · 走 `PATCH /cardId` · 立即视觉成功 | 失败 = Toast + 回滚 + invalidate |

- 跨列拖命中冲突时,拖拽卡片停在原列(前端不动 order_index)+ 弹 Modal
- 列内重排乐观失败时,react-query `onError` 还原 `queryClient.setQueryData` 缓存

> 不选全乐观(A):跨列拖涉及 Guard,欺骗用户「已成功」是 UX 反模式。
> 不选全悲观(B):列内重排无 Guard,wait 浪费 200ms+ 给用户「卡顿感」。

### D6. 父子互锁冲突 UI = 复用 StatusConstraintModal

- 跨列拖命中冲突 → 复用 `apps/web/src/components/board/detail/StatusConstraintModal.tsx`
- 完全沿用 ADR-0025 D2 三选项:**A 强制切换(override=true) / B 父降级 / C 取消**
- 拖拽中零预提示(决策 24「克制,在场」);目标列不变色、不打 hover 提示
- Modal 内「父 status 派生预览」字段沿用 detail 页同款

> 不在拖拽中给目标列色变 / hover 提示(视觉脏,父 status 实际少变)。

### D7. 详情页 order_index 只读展示

- 详情页右栏属性表(ADR-0027 D5.1)新增「列内位置」行
- 展示形式 = `「#N / M」`,N = 当前 index(列内按 `order_index asc, null last` 计 1-indexed),
  M = 列内总数
- readonly,无编辑控件(看板是唯一编辑入口)
- 跨需求跨详情页版本稳定:同一卡片的序号不变,除非该列内排序变化

> 不选不展示(A):字段表 13 字段 vs 8 字段,失约 ADR-0024 D1。
> 不选可手动改(C):「在详情页改 order_index」与「在看板拖」心智分裂。

---

## 实施位置

### web 端

```
apps/web/src/components/board/
├── BoardSection.tsx           包 <DndContext> + 拖拽 sensors
├── Column.tsx                 包 <SortableContext strategy={verticalListSortingStrategy}>
├── Card.tsx                   useSortable + 左侧手柄 sprite
├── detail/
│   ├── StatusConstraintModal.tsx  复用(零改动)
│   └── BoardCardDetailPage.tsx    加「列内位置 #N / M」只读行
└── DragSortableOverlay.tsx    新建 · <DragOverlay> 拖拽中卡片 ghost

apps/web/src/lib/
├── board-hooks.ts             加 useMoveCardToColumn / useReorderCard
└── board-drag-sort.ts         新建 · 浮点中位算法 + 列表排序
```

### shared

```
packages/shared/src/
└── board-drag-sort.ts         新建 · 纯算法工具(可被 agent / web 调用)
```

### 测试

- `task-card-store.test.ts` 加 ordering 算法测试(精度耗尽 / null 排序 / 跨列重排)
- `board-section-drag.test.tsx`(新)· 单元 + 集成 + @dnd-kit 模拟
- `board-card-detail.test.tsx` 加「列内位置」字段测试
- `board-drag-sort.test.ts`(新)· 算法纯函数

### 视觉

- `docs/design/pages/board-drag-sort.html`(新)· 拖拽中 ghost / 拖拽 placeholder / 拖拽至列头尾示意
- `board-color-options.html`(D3 视觉基线)· 同步加 `⋮⋮` 手柄示意

### 依赖

`apps/web/package.json` dependencies 加:
```
"@dnd-kit/core": "^6.1.0",
"@dnd-kit/sortable": "^8.0.0",
"@dnd-kit/utilities": "^3.2.2"
```

---

## 决策守门

- **不得**在拖拽中触发 Run / PRD 拆解 / 任何 AI 副作用(ADR-0023 守门)
- 复用 `StatusConstraintModal` 的 `override` 字段必须走 `useUpdateCardStatus`(`board-detail-hooks.ts:139` 已落)
- 「不在范围内」段列出的功能(跨列拖到指定位置 / 拖拽触发动画)留 v1.0.x 后续增量,不得擅自入本期

---

## 不在范围

- 跨列拖到指定位置(D1 不含 order_index 实时跨列计算)→ v1.0.x 后续
- 拖拽中 hover 跨列占位线 preview → v1.0.x 后续
- 拖拽触发动画 / 物理反馈 / 声音 → 决策 24「克制,在场」
- 跨 Requirement 聚合看板拖拽 → 留 P2+
- 子卡依赖关系拖拽约束(depends_on)→ 留 P2+

---

## 主要取舍

- **选「浮点中位」而非「整数连续」**:前者写入 O(1),后续 PATCH 失败重试 idempotent;
  整数连续每次插入都惊动整列,原子写难做;浮点中位精度耗尽罕见,且重排触发时
  折半算法可控
- **选「分级乐观/悲观」而非「全乐观」**:跨列拖涉及 Guard,欺骗用户「已成功」
  是 UX 反模式;列内重排无 Guard,乐观零成本
- **选「复用 StatusConstraintModal」而非「简化二选」**:决策 100 锁定 ADR-0025 D2,
  看板与详情页同款 UI 是决策 36「单一真相源」字面落地
- **选「hover 才显手柄」而非「始终显」**:决策 24「克制,在场」+ 决策 17 Linear 风格

---

## 关联

- 上游(已锁定):
  - [ADR-0024](0024-taskcard-card-model.md) D1 字段集(13 字段含 `order_index`,本期首次启用)
  - [ADR-0027](0027-board-section-intro.md) D3 「拖拽(本期不做,留 P1+)」陈述延期项
  - [ADR-0025](0025-parent-child-status-lock.md) D2 父 status 派生 Guard 三选项
- 下游(本期新增):
  - `apps/web/src/lib/board-hooks.ts` 加 `useMoveCardToColumn` / `useReorderCard`
  - `apps/web/src/components/board/BoardSection.tsx` 包 `<DndContext>`
  - `apps/web/src/components/board/Column.tsx` / `Card.tsx` 接入 sortable
  - `apps/web/src/components/board/detail/BoardCardDetailPage.tsx` 加「列内位置」行
  - `apps/web/src/components/board/detail/StatusConstraintModal.tsx` 拖拽场景复用(零改动)
- 测试:
  - `task-card-store.test.ts` 加 ordering 算法测试
  - `board-section-drag.test.tsx`(新)· 单元 + 集成
  - `board-card-detail.test.tsx` 加「列内位置」字段测试
- 视觉:
  - 视觉基线同步更新 `docs/design/pages/board-drag-sort.html`(新建)
