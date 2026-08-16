'use client'

/**
 * board 单张卡片(中等密度 112-120px,图 1 形态)— issue 07 / ADR-0027 D3
 *
 * 视觉对照基线:`docs/design/pages/board-color-options.html` .card 规则。
 *
 * 卡片结构(自上而下):
 * - 顶部:id-short(mono,ULID 末 4)+ 右侧 ⋯ 菜单(archive)
 * - title(2 行 line-clamp)
 * - summary(2 行 line-clamp,content 首 80 字)
 * - 底部 meta 行:priority badge + 右侧(source 小标 + labels chip + assignee 头像)
 *
 * 本期卡片点击(issue 08):由 BoardSection 注入 `onClick` → router.push 进
 * `/requirements/[id]/board/[cardId]` 详情页(ADR-0027 D5 toggle 双态)。
 * `onClick` prop 仍 optional —— 无 onClick 时卡片不可点击(测试 / 静态展示用)。
 *
 * 拖拽(issue 19 / ADR-0035 D4):左侧 `⋮⋮` 6 点手柄,hover 才显,默认 `opacity: 0`。
 * `useSortable` 接管 transform / transition / ref;`isDragging` 时整张卡淡化让
 * DragOverlay (BoardSection) 接管 visual。
 */

import { useState } from 'react'
import type { TaskCard } from '@ai-devspace/shared'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PRIORITY_BADGE,
  SOURCE_LABEL,
  assigneeInitial,
  shortCardId,
  summarizeContent,
} from '@/lib/board'

export interface BoardCardProps {
  card: TaskCard
  /** 卡片点击(进详情)。本期默认 undefined = 不可点击(ticket 08 接详情页)。 */
  onClick?: (cardId: string) => void
  /** 卡片菜单 archive 触发 */
  onArchive?: (cardId: string) => void
  /**
   * 拖拽开关(issue 19 / ADR-0035)。
   * - `true`(默认)→ 接 `useSortable`,左侧手柄可拖
   * - `false` → 跳过 sortable,左侧手柄不渲染(测试 / 静态展示用)
   */
  draggable?: boolean
}

export function BoardCard({ card, onClick, onArchive, draggable = true }: BoardCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const priorityBadge = card.priority ? PRIORITY_BADGE[card.priority] : null
  const sourceLabel = SOURCE_LABEL[card.source]
  const summary = summarizeContent(card.content)
  const initial = assigneeInitial(card.assignee)
  const hasAssignee = card.assignee !== null && card.assignee.length > 0

  // 拖拽(issue 19 / ADR-0035 D4):useSortable 由 BoardSection <DndContext> 包裹
  const sortable = useSortable({
    id: card.id,
    disabled: !draggable,
    data: { type: 'card', status: card.status },
  })
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = sortable
  const dragStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    onArchive?.(card.id)
  }

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen((v) => !v)
  }

  // 手柄 click / keydown 触发拖拽 — 阻止冒泡到 article 的 onClick(进详情)
  const handleDragHandle = (e: React.SyntheticEvent) => {
    e.stopPropagation()
  }

  return (
    <article
      ref={draggable ? setNodeRef : undefined}
      data-testid="board-card"
      data-card-id={card.id}
      data-status={card.status}
      data-priority={card.priority ?? 'none'}
      data-source={card.source}
      data-dragging={isDragging ? 'true' : 'false'}
      onClick={onClick ? () => onClick(card.id) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={draggable ? dragStyle : undefined}
      className={`group bg-bg-elevated border border-border rounded-md p-3 flex flex-col gap-2 transition-all ${
        onClick ? 'cursor-pointer hover:border-brand hover:shadow-md hover:-translate-y-px' : ''
      }`}
    >
      {/* 顶部:id-short + 菜单 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {/* 拖拽手柄(issue 19 / ADR-0035 D4):左侧 ⋮⋮ 6 点,hover 才显 */}
          {draggable && (
            <button
              type="button"
              data-testid="board-card-drag-handle"
              aria-label="拖动卡片"
              onClick={handleDragHandle}
              onMouseDown={handleDragHandle}
              className="cursor-grab active:cursor-grabbing text-text-3 opacity-0 group-hover:opacity-100 transition-opacity leading-none px-0.5 -ml-1 touch-none"
              {...attributes}
              {...listeners}
            >
              <span className="inline-grid grid-cols-2 gap-[1px] text-[10px]" aria-hidden="true">
                <span>⋮</span>
                <span>⋮</span>
                <span>⋮</span>
                <span>⋮</span>
              </span>
            </button>
          )}
          <span className="font-mono text-xs text-text-3" data-testid="board-card-id">
            {shortCardId(card.id)}
          </span>
        </div>
        {onArchive && (
          <div className="relative">
            <button
              type="button"
              data-testid="board-card-menu"
              onClick={toggleMenu}
              aria-label="卡片菜单"
              className="text-text-3 hover:text-text-1 text-sm leading-none px-1"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                data-testid="board-card-menu-dropdown"
                className="absolute right-0 top-6 z-10 bg-bg-elevated border border-border rounded-md shadow-md py-1 min-w-[120px]"
              >
                <button
                  type="button"
                  data-testid="board-card-menu-archive"
                  onClick={handleArchive}
                  className="w-full text-left px-3 py-1.5 text-sm text-text-1 hover:bg-bg-subtle"
                >
                  归档
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* title(2 行) */}
      <div
        className="text-sm font-medium text-text-1 leading-snug"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
        data-testid="board-card-title"
      >
        {card.title}
      </div>

      {/* summary(2 行,空 content 不渲染) */}
      {summary && (
        <div
          className="text-xs text-text-2 leading-relaxed"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          data-testid="board-card-summary"
        >
          {summary}
        </div>
      )}

      {/* 底部 meta 行 */}
      <div
        data-testid="board-card-meta"
        className="flex items-center gap-2 pt-1 mt-1 border-t border-dashed border-border"
      >
        {/* priority badge */}
        {priorityBadge ? (
          <span
            data-testid="board-card-priority"
            data-priority={card.priority}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-sm"
            style={{ background: priorityBadge.bg, color: priorityBadge.text }}
          >
            {priorityBadge.label}
          </span>
        ) : (
          <span
            data-testid="board-card-priority"
            data-priority="none"
            className="inline-flex items-center text-[11px] font-semibold px-1.5 py-0.5 rounded-sm bg-bg-subtle text-text-3"
          >
            -
          </span>
        )}

        {/* 右侧:source + labels + assignee */}
        <div className="ml-auto flex items-center gap-1">
          <span
            data-testid="board-card-source"
            data-source={card.source}
            className="text-[10px] text-text-3 uppercase tracking-wide"
          >
            {sourceLabel}
          </span>
          {card.labels.map((label) => (
            <span
              key={label}
              data-testid="board-card-label"
              data-label={label}
              className="text-[10px] px-1.5 py-0.5 rounded-sm bg-bg-subtle text-text-2"
            >
              {label}
            </span>
          ))}
          <span
            data-testid="board-card-assignee"
            data-has-assignee={hasAssignee ? 'true' : 'false'}
            className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-semibold ${
              hasAssignee
                ? 'text-white'
                : 'bg-bg-subtle text-text-3 border border-dashed border-border-strong'
            }`}
            style={
              hasAssignee
                ? { background: 'linear-gradient(135deg,#fb923c,#f43f5e)' }
                : undefined
            }
          >
            {initial}
          </span>
        </div>
      </div>
    </article>
  )
}
