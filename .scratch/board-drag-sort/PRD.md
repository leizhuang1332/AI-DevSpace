---
Status: ready-for-agent
Type: prd
Created: 2026-08-16
Feature: board-drag-sort
Supersedes: 无(在 ADR-0027 架构上的延期项解锁)
Implements: 用户原诉求「继续完善 board,实现卡片拖拽功能」
Implements ADR: docs/adr/0035-board-drag-sort.md
Related:
  - .scratch/codebase-detach/PRD.md(issue tracker 模板参考)
  - docs/adr/0027-board-section-intro.md(本期解锁的延期项持有者)
  - docs/adr/0024-taskcard-card-model.md(order_index 字段源头)
  - docs/adr/0025-parent-child-status-lock.md(冲突 UI 复用)
  - docs/adr/0028-taskcard-transcript-independence.md(详情页右栏 toggle)
  - docs/agents/issue-tracker.md(feature-per-directory 约定)
  - docs/agents/domain.md(术语 SSoT)
---

# board section 拖拽重排 + 浮点中位顺序算法 · PRD

> 本 PRD 是 ADR-0035 的任务拆分文档。7 轮 grill-with-docs 决策已锁,
> 实施按 `issues/01-drag-sort-end-to-end.md` 推进。

---

## 1. Problem Statement

[ADR-0027 D3](docs/adr/0027-board-section-intro.md) 明确推迟了「拖拽行为(本期不做,留 P1+)」:

> 「拖拽行为(本期不做,留 P1+):本期只接受"点 + / 选状态"两步操作推进卡片;
> `order_index` 默认 null(列尾追加)」

[ADR-0024 D1](docs/adr/0024-taskcard-card-model.md) 字段集 13 字段中已包含 `order_index: number | null`,
但前端从未读写过。`TaskCardStore.list()` 按 `updated_at desc` 排序,完全忽略 `order_index`。

本期 7 轮 grilling 沉淀 7 决策 D1-D7,写入 ADR-0035 + CONTEXT.md v1.0.8 增量段(决策 121-127)。
用户原始诉求 = 「继续完善 board,实现卡片拖拽功能」。

## 2. 用户原话

> 「继续完善 board,实现卡片拖拽功能」

## 3. 7 项决策概要(详细见 `decisions.md`)

| # | 决策 | 锁定 |
|---|---|---|
| 1 | 范围 | B · 跨列(改 status) + 列内重排(改 order_index) |
| 2 | `order_index` 算法 | A · 浮点中位法;null 列尾追加;精度耗尽 < 1e-6 重排 |
| 3 | 拖拽库 | @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities |
| 4 | 触发器 | B · 左侧 `⋮⋮` 6 点手柄,hover 才显,5px 移动阈值 |
| 5 | 落盘策略 | C · 跨列拖悲观(等 Guard);列内重排乐观 |
| 6 | 父子互锁冲突 UI | A · 复用 StatusConstraintModal 三选项 |
| 7 | 详情页 order_index | B · 只读展示「列内位置 #N / M」 |

## 4. 关键路径

- `packages/shared/src/board-drag-sort.ts` —— 浮点中位算法 + 列排序 + rankInColumn
- `apps/web/src/lib/board-hooks.ts` —— `useMoveCardToColumn` / `useReorderCard`(两套 mutation)
- `apps/web/src/components/board/BoardSection.tsx` —— 包 `<DndContext>` + DragOverlay + handleDragEnd
- `apps/web/src/components/board/Column.tsx` —— SortableContext + useDroppable
- `apps/web/src/components/board/Card.tsx` —— useSortable + 左侧手柄 sprite
- `apps/web/src/components/board/detail/CardSideProperty.tsx` —— 「列内位置 #N / M」只读行
- `apps/web/src/components/board/detail/StatusConstraintModal.tsx` —— 跨列拖命中冲突时复用(零改动)
- `docs/design/pages/board-drag-sort.html` —— 视觉基线(5 状态展示)

## 5. 验收清单

完整 5 阶段产物 = 7 轮 grill 决策 + ADR-0035 + CONTEXT.md 决策 121-127 + 5 阶段代码 + 30+ 单测 + 视觉原型。详细 issue 拆分见 `issues/01-drag-sort-end-to-end.md`。
