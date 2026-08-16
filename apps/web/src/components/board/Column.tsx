'use client'

/**
 * board 单列(5 列之一)— issue 07 / ADR-0027 D3
 *
 * 视觉对照基线:`docs/design/pages/board-color-options.html` .column 规则(方案 A);
 * 拖拽视觉对照基线:`docs/design/pages/board-drag-sort-C.html`(C 方案)。
 *
 * 列结构:
 * - column-head:status dot(实心/空心)+ 列名(nameColor)+ N 计数 + `+` 按钮
 * - cards 槽:flex column gap,空态显示 placeholder 文案
 * - 列背景 tint(bgColor)+ 列名文字色(nameColor)按 `STATUS_COLUMNS` token
 *
 * `+` 按钮触发 `onAddCard(status)` → 预填该列 status 打开 NewTaskModal。
 *
 * 拖拽(issue 19 / ADR-0035 D4 v2 · C 方案):
 * - 卡片槽包 `<SortableContext>` 让卡片列内 sortable
 * - 列接 `useDroppable` 让空列也能 drop(其他列跨列拖)
 * - 空列 + 跨列拖 → 显示 120px placeholder "释放此处 →"(issue 19 ADR-0035 D2 锁定)
 * - 非空列 + 跨列拖 → 现有卡片 `translateY(8px) + opacity:0.7` 让位 200ms ease-out
 * - 占位 / 让位 仅在跨列拖时触发(同列拖由 @dnd-kit sortable 自动接管)
 */

import type { TaskCard, TaskCardStatusT } from '@ai-devspace/shared'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { STATUS_COLUMNS } from '@/lib/board'
import { BoardCard } from './Card'

export interface BoardColumnProps {
  status: TaskCardStatusT
  cards: TaskCard[]
  /** 卡片点击(进详情,本期可 undefined) */
  onCardClick?: (cardId: string) => void
  /** 卡片菜单 archive */
  onCardArchive?: (cardId: string) => void
  /** 列头 `+` 按钮(预填 status 创建 manual 卡) */
  onAddCard?: (status: TaskCardStatusT) => void
  /** 当前正在拖拽的卡片 id(BoardSection 注入) */
  activeDragCardId?: string | null
  /** 当前正在拖拽的卡片原 status(BoardSection 注入) */
  activeDragFromStatus?: TaskCardStatusT | null
}

export function BoardColumn({
  status,
  cards,
  onCardClick,
  onCardArchive,
  onAddCard,
  activeDragCardId = null,
  activeDragFromStatus = null,
}: BoardColumnProps) {
  const col = STATUS_COLUMNS[status]
  const dotStyle: React.CSSProperties = col.dotHollow
    ? {
        background: 'transparent',
        border: `1.5px solid ${col.dotColor}`,
      }
    : { background: col.dotColor }

  // 列整体可 drop(issue 19 / ADR-0035):让跨列拖的目标列即使是空列也能接受
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  })

  // C 方案让位 / 占位逻辑(ADR-0035 + grill 锁):
  // 仅在跨列拖(isOver && activeDragFromStatus !== status)时生效。
  const hasActiveDrag = activeDragCardId !== null
  const isCrossColumnDrag = hasActiveDrag && activeDragFromStatus !== status
  const showPlaceHolder = isOver && isCrossColumnDrag && cards.length === 0
  const isColDisplaced = isOver && isCrossColumnDrag && cards.length > 0

  return (
    <section
      data-testid="board-column"
      data-status={status}
      data-count={String(cards.length)}
      data-over={isOver ? 'true' : 'false'}
      data-displaced={isColDisplaced ? 'true' : 'false'}
      className="rounded-lg p-3 flex flex-col gap-2 border border-border transition-colors"
      style={{
        background: isOver ? '#eef0fb' : col.bgColor,
        borderColor: isOver ? '#5e6ad2' : undefined,
        boxShadow: isOver ? 'inset 0 0 0 2px #dadef7' : undefined,
      }}
    >
      {/* 列头 */}
      <div className="flex items-center gap-2 px-1 pb-2 border-b border-border mb-1">
        <span
          data-testid="board-column-dot"
          data-hollow={col.dotHollow ? 'true' : 'false'}
          className="w-2 h-2 rounded-full shrink-0"
          style={dotStyle}
        />
        <span
          data-testid="board-column-name"
          className="text-sm font-semibold"
          style={{ color: col.nameColor }}
        >
          {col.label}
        </span>
        <span
          data-testid="board-column-count"
          className="text-xs text-text-3 bg-bg-subtle px-1.5 py-0.5 rounded-sm ml-auto"
        >
          {cards.length}
        </span>
        {onAddCard && (
          <button
            type="button"
            data-testid="board-column-add"
            onClick={() => onAddCard(status)}
            aria-label={`在 ${col.label} 列新建任务`}
            className="text-text-3 hover:text-text-1 text-sm leading-none ml-1"
          >
            +
          </button>
        )}
      </div>

      {/* cards 槽(SortableContext + useDroppable) */}
      <div
        ref={setNodeRef}
        data-testid="board-column-cards"
        className="flex flex-col gap-2 flex-1 min-h-[200px]"
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.length === 0 ? (
            showPlaceHolder ? (
              <div
                data-testid="board-column-placeholder"
                className="h-[120px] border-2 border-dashed border-brand rounded-md bg-brand-50 flex items-center justify-center text-xs font-medium text-brand-700"
              >
                释放此处 →
              </div>
            ) : (
              <div
                data-testid="board-column-empty"
                className="flex-1 flex items-center justify-center text-xs text-text-3 border border-dashed border-border rounded-md min-h-[80px]"
              >
                拖动卡片到此处
              </div>
            )
          ) : (
            cards.map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                onClick={onCardClick}
                onArchive={onCardArchive}
                // 跨列拖时本列其它卡片让位(C 方案 + grill 锁定):
                // translateY(8px) + opacity:0.7,200ms ease-out
                displaced={isColDisplaced}
              />
            ))
          )}
        </SortableContext>
      </div>
    </section>
  )
}
