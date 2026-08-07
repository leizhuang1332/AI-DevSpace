'use client'

/**
 * board 单列(5 列之一)— issue 07 / ADR-0027 D3
 *
 * 视觉对照基线:`docs/design/pages/board-color-options.html` .column 规则(方案 A)。
 *
 * 列结构:
 * - column-head:status dot(实心/空心)+ 列名(nameColor)+ N 计数 + `+` 按钮
 * - cards 槽:flex column gap,空态显示 placeholder 文案
 * - 列背景 tint(bgColor)+ 列名文字色(nameColor)按 `STATUS_COLUMNS` token
 *
 * `+` 按钮触发 `onAddCard(status)` → 预填该列 status 打开 NewTaskModal。
 */

import type { TaskCard, TaskCardStatusT } from '@ai-devspace/shared'
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
}

export function BoardColumn({
  status,
  cards,
  onCardClick,
  onCardArchive,
  onAddCard,
}: BoardColumnProps) {
  const col = STATUS_COLUMNS[status]
  const dotStyle: React.CSSProperties = col.dotHollow
    ? {
        background: 'transparent',
        border: `1.5px solid ${col.dotColor}`,
      }
    : { background: col.dotColor }

  return (
    <section
      data-testid="board-column"
      data-status={status}
      data-count={String(cards.length)}
      className="rounded-lg p-3 flex flex-col gap-2 border border-border"
      style={{ background: col.bgColor }}
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

      {/* cards 槽 */}
      <div
        data-testid="board-column-cards"
        className="flex flex-col gap-2 flex-1 min-h-[200px]"
      >
        {cards.length === 0 ? (
          <div
            data-testid="board-column-empty"
            className="flex-1 flex items-center justify-center text-xs text-text-3 border border-dashed border-border rounded-md min-h-[80px]"
          >
            拖动卡片到此处
          </div>
        ) : (
          cards.map((card) => (
            <BoardCard
              key={card.id}
              card={card}
              onClick={onCardClick}
              onArchive={onCardArchive}
            />
          ))
        )}
      </div>
    </section>
  )
}
