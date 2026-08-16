---
Status: ready-for-agent
Type: task
Created: 2026-08-16
Feature: board-drag-sort
Parent: .scratch/board-drag-sort/PRD.md
Blocked by: 无
Blocks: 无
ADR: docs/adr/0035-board-drag-sort.md
Supersedes: 无
---

# Issue 01: board 拖拽重排 端到端实施

## 背景

7 轮 grill-with-docs 共识已锁,见 `decisions.md`。

## 用户原始诉求

> 「继续完善 board,实现卡片拖拽功能」

## 目标

实现 5 列看板的拖拽重排 + 浮点中位算法 + 详情页只读位置展示 + 冲突弹 Modal,
端到端贯通 5 阶段。详细架构见 ADR-0035。

## 改动清单

### shared 算法层

| # | 文件 | 改动 |
|---|---|---|
| 1 | [packages/shared/src/board-drag-sort.ts](../../packages/shared/src/board-drag-sort.ts) | 新增:浮点中位 + 排序 + rankInColumn + IndexPrecisionExhaustedError |
| 2 | [packages/shared/src/index.ts](../../packages/shared/src/index.ts) | 加 `export * from './board-drag-sort'` |
| 3 | [packages/shared/src/__tests__/board-drag-sort.test.ts](../../packages/shared/src/__tests__/board-drag-sort.test.ts) | 新增:23 条用例,覆盖 5 工具 + 精度耗尽 + null 排序 + 同值取整 |

### web 端 hooks

| # | 文件 | 改动 |
|---|---|---|
| 4 | [apps/web/src/lib/board-hooks.ts](../../apps/web/src/lib/board-hooks.ts) | 加 `useMoveCardToColumn`(跨列拖二段式:先 status 后 order_index;返 `{ok, conflicts}` 给 caller 弹 Modal);加 `useReorderCard`(列内重排乐观 + 失败还原) |
| 5 | [apps/web/src/components/board/BoardSection.tsx](../../apps/web/src/components/board/BoardSection.tsx) | 包 `<DndContext>` + `<DragOverlay>`;Sensors = `PointerSensor { distance: 5 }`;`handleDragEnd` 拆 3 路径:over=column → 跨列拖;over=card 同列 → 重排;over=card 跨列 → 跨列拖;冲突时 `setPendingConflict` 弹 Modal |
| 6 | [apps/web/src/components/board/Column.tsx](../../apps/web/src/components/board/Column.tsx) | `useDroppable({ id: 'column-${status}' })` + `SortableContext strategy={verticalListSortingStrategy}`;接 `isOver` 高亮 |
| 7 | [apps/web/src/components/board/Card.tsx](../../apps/web/src/components/board/Card.tsx) | `useSortable({ id: card.id, disabled: !draggable })`;加左侧 `⋮⋮` 6 点手柄 sprite,`opacity:0 group-hover:opacity:100`;`isDragging` 时 `opacity:0.4` 让位给 DragOverlay |
| 8 | [apps/web/src/components/board/detail/CardSideProperty.tsx](../../apps/web/src/components/board/detail/CardSideProperty.tsx) | 加「列内位置」只读行:展示形式 `「#N / M」`,右侧 hint「在看板拖动」 |
| 9 | [apps/web/package.json](../../apps/web/package.json) | dependencies 加 `@dnd-kit/core@^6.1.0` `@dnd-kit/sortable@^8.0.0` `@dnd-kit/utilities@^3.2.2` |

### 测试

| # | 文件 | 改动 |
|---|---|---|
| 10 | [apps/web/src/__tests__/board/board-section.test.tsx](../../apps/web/src/__tests__/board/board-section.test.tsx) | 补 mock `useMoveCardToColumn` + `useReorderCard`(避免 12 失败) |
| 11 | [apps/web/src/__tests__/board/board-section-drag.test.tsx](../../apps/web/src/__tests__/board/board-section-drag.test.tsx) | 新增:7 条集成用例,覆盖手柄 DOM 标记 + 卡片可拖属性 + 5 列 droppable + 点击不冲突 + archive 不冲突 |

### 视觉

| # | 文件 | 改动 |
|---|---|---|
| 12 | [docs/design/pages/board-drag-sort.html](../../docs/design/pages/board-drag-sort.html) | 新增:5 段视觉基线 = 静态状态(hover 显手柄) + 跨列拖(目标列高亮) + 详情页只读行(2 示例) + 冲突 Modal + 规则速查 |

### ADR / 术语

| # | 文件 | 改动 |
|---|---|---|
| 13 | [docs/adr/0035-board-drag-sort.md](../../docs/adr/0035-board-drag-sort.md) | 新增:ADR-0035 全文含 D1-D7 + 实施位置 + 守门 + 不在范围 |
| 14 | [CONTEXT.md](../../CONTEXT.md) | v1.0.8 增量段接续 119/120 加 121-127 决策 + ADR-0035 引用 |

## 验收

- [x] `pnpm --filter @ai-devspace/shared test board-drag-sort` 23/23 ✓
- [x] `pnpm --filter @ai-devspace/web typecheck` 无新增错误(基线 2 个 sdkSesssionEstablished 错误无关)
- [x] `pnpm --filter @ai-devspace/web test board-section-drag` 7/7 ✓
- [x] `pnpm --filter @ai-devspace/web test` 总计 1319/1320(剩 1 个 Windows 路径 baseline 错误无关)
- [ ] E2E playwright(本期未实施,留 v1.0.x 后续)

## 不在范围(沿用 ADR-0035 「不在范围」段)

- 跨列拖到指定位置(精确插入线)
- 拖拽动画 / 物理反馈 / 声音
- 跨 Requirement 聚合看板拖拽
- 子卡依赖关系(depends_on)拖拽约束
