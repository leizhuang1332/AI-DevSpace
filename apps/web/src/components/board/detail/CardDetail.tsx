'use client'

/**
 * board 卡片详情页 — 左主区 CardDetail(issue 08 / ADR-0027 D5)
 *
 * 视觉对照基线:`docs/design/pages/board-detail-final.html` .main 块。
 *
 * 结构(自上而下):
 * - task-title row:shortCardId(mono)+ h1 title + 🗑 delete / ⋯ more
 * - 顶部 6 chip(status / priority / source / assignee / created / updated)
 * - 父 Requirement 进度条(computeParentProgress → bar + 「N / M 卡」)
 * - Content Markdown(<MarkdownContent source={card.content}/>)
 * - 子任务列表(filterSubtasks)
 * - 依赖卡列表(filterDependencies)
 * - 「详细信息 ▾」折叠(8 项冷字段)
 *
 * status chip 点击 → onStatusChange(走 PATCH /cards/:cardId/status → Guard → 可能弹 Modal)
 * 删除按钮(issue 03 / ADR-0036)→ onDelete:caller 弹 ConfirmDeleteDialog 二次确认
 */

import type { RequirementSummary, TaskCard, TaskCardStatusT } from '@ai-devspace/shared'
import {
  PRIORITY_BADGE,
  SOURCE_LABEL,
  assigneeInitial,
  computeParentProgress,
  filterDependencies,
  filterSubtasks,
  formatRelativeTime,
  shortCardId,
  STATUS_COLUMNS,
  STATUS_COLUMN_ORDER,
} from '@/lib/board'
import { MarkdownContent } from './MarkdownContent'

export interface CardDetailProps {
  card: TaskCard
  /** 全量卡片(子任务/依赖派生用) */
  cards: TaskCard[]
  /** 父 Requirement summary(进度条 status / crumb title) */
  parentSummary: RequirementSummary | null
  /** status 变更触发(PATCH /status → Guard → 可能弹 Modal) */
  onStatusChange?: (newStatus: TaskCardStatusT) => void
  /**
   * 删除任务触发(issue 03 / ADR-0036)。
   * caller 负责弹 ConfirmDeleteDialog → 物理删除 → 路由错误(409 blocker / Toast)
   */
  onDelete?: () => void
}

export function CardDetail({
  card,
  cards,
  parentSummary,
  onStatusChange,
  onDelete,
}: CardDetailProps) {
  const statusCol = STATUS_COLUMNS[card.status]
  const priorityBadge = card.priority ? PRIORITY_BADGE[card.priority] : null
  const sourceLabel = SOURCE_LABEL[card.source]
  const progress = computeParentProgress(cards)
  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const subtasks = filterSubtasks(cards, card.id)
  const dependencies = filterDependencies(cards, card)

  return (
    <div
      data-testid="board-card-detail"
      data-card-id={card.id}
      className="p-5 bg-bg-elevated min-w-0"
    >
      {/* task-title row */}
      <div className="flex items-center gap-3 mb-2" data-testid="board-detail-title-row">
        <span
          className="font-mono text-xs text-text-3 px-1.5 py-0.5 bg-bg-subtle rounded-sm border border-border"
          data-testid="board-detail-id"
        >
          {shortCardId(card.id)}
        </span>
        <h1
          className="text-xl font-semibold tracking-tight flex-1 text-text-1"
          data-testid="board-detail-title"
        >
          {card.title}
        </h1>
        <div className="flex gap-2" data-testid="board-detail-actions">
          {onDelete && (
            <button
              type="button"
              data-testid="board-detail-delete"
              onClick={onDelete}
              aria-label="删除任务"
              title="删除任务"
              className="w-8 h-8 rounded-md border border-border bg-bg-elevated text-text-2 hover:border-text-3 hover:text-text-1 inline-flex items-center justify-center"
            >
              🗑
            </button>
          )}
          <button
            type="button"
            aria-label="更多"
            title="更多"
            className="w-8 h-8 rounded-md border border-border bg-bg-elevated text-text-2 hover:border-text-3 hover:text-text-1 inline-flex items-center justify-center"
          >
            ⋯
          </button>
        </div>
      </div>

      {/* 顶部 6 chip */}
      <div
        className="flex flex-wrap gap-2 py-3 mb-4 border-b border-dashed border-border"
        data-testid="board-detail-chip-row"
      >
        {/* status chip(可改) */}
        <div className="relative inline-flex">
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs cursor-pointer"
            style={{ background: statusCol.bgColor, borderColor: statusCol.dotColor + '4d', color: statusCol.nameColor }}>
            <span className="w-2 h-2 rounded-full" style={{ background: statusCol.dotColor }} />
            <span className="text-text-3 text-[11px]">状态</span>
            {onStatusChange ? (
              <select
                data-testid="board-detail-status-select"
                value={card.status}
                onChange={(e) => onStatusChange(e.target.value as TaskCardStatusT)}
                className="bg-transparent font-medium cursor-pointer outline-none pr-3"
                style={{ color: statusCol.nameColor }}
              >
                {STATUS_COLUMN_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_COLUMNS[s].label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium">{statusCol.label}</span>
            )}
          </label>
        </div>

        {/* priority chip */}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs"
          data-testid="board-detail-priority-chip"
          style={
            priorityBadge
              ? { background: priorityBadge.bg, borderColor: priorityBadge.bg, color: priorityBadge.text }
              : { background: 'var(--bg-subtle)', borderColor: 'var(--border)', color: 'var(--text-3)' }
          }
        >
          <span className="text-text-3 text-[11px]">优先级</span>
          <span className="font-medium">
            {priorityBadge ? priorityBadge.label : '无'}
          </span>
        </span>

        {/* source chip */}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs bg-bg-subtle border-border text-text-2"
          data-testid="board-detail-source-chip"
        >
          <span className="text-text-3 text-[11px]">来源</span>
          <span className="font-medium">{sourceLabel}</span>
        </span>

        {/* assignee chip */}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs bg-bg-subtle border-border text-text-2"
          data-testid="board-detail-assignee-chip"
        >
          <span
            className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-white text-[9px] font-semibold"
            style={
              card.assignee
                ? { background: 'linear-gradient(135deg,#fb923c,#f43f5e)' }
                : { background: 'var(--bg-subtle)', color: 'var(--text-3)' }
            }
          >
            {assigneeInitial(card.assignee)}
          </span>
          <span className="text-text-3 text-[11px]">负责人</span>
          <span className="font-medium">
            {card.assignee ?? '未指派'}
          </span>
        </span>

        {/* created chip */}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs bg-bg-subtle border-border text-text-2"
          data-testid="board-detail-created-chip"
        >
          <span className="text-text-3 text-[11px]">创建</span>
          <span className="font-medium">{formatRelativeTime(card.created_at)}</span>
        </span>

        {/* updated chip */}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs bg-bg-subtle border-border text-text-2"
          data-testid="board-detail-updated-chip"
        >
          <span className="text-text-3 text-[11px]">更新</span>
          <span className="font-medium">{formatRelativeTime(card.updated_at)}</span>
        </span>
      </div>

      {/* 父 Requirement 进度条 */}
      <div
        className="flex items-center gap-3 px-3 py-2 bg-bg-elevated border border-border rounded-md mb-5"
        data-testid="board-detail-progress"
      >
        <span className="text-sm font-medium text-text-2">父 Requirement 进度</span>
        <div className="flex-1 h-1.5 bg-bg-subtle rounded-sm overflow-hidden">
          <div
            className="h-full bg-brand rounded-sm"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-xs text-text-3 tabular-nums">
          {progress.done} / {progress.total} 卡
        </span>
      </div>

      {/* Content Markdown */}
      {card.content && (
        <div className="mb-5" data-testid="board-detail-content-section">
          <h4 className="text-xs text-text-3 uppercase tracking-wide mb-2 font-semibold">
            Content
          </h4>
          <div className="px-4 py-3 bg-bg-elevated border border-border rounded-md text-sm text-text-2">
            <MarkdownContent source={card.content} />
          </div>
        </div>
      )}

      {/* 子任务列表 */}
      <div className="mb-5" data-testid="board-detail-subtasks">
        <h4 className="text-xs text-text-3 uppercase tracking-wide mb-2 font-semibold flex items-center gap-2">
          子任务
          <span className="bg-bg-subtle text-text-3 px-1.5 py-0.5 rounded-sm text-[10px] font-medium">
            {subtasks.length}
          </span>
        </h4>
        {subtasks.length === 0 ? (
          <div className="px-4 py-3 bg-bg-elevated border border-border rounded-md text-xs text-text-3">
            无子任务
          </div>
        ) : (
          <div className="px-3 py-2 bg-bg-elevated border border-border rounded-md">
            {subtasks.map((sub) => {
              const subCol = STATUS_COLUMNS[sub.status]
              return (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 py-1.5 text-sm border-b border-border last:border-0"
                >
                  <span className="font-mono text-xs text-text-3">{shortCardId(sub.id)}</span>
                  <span className="flex-1 text-text-1">{sub.title}</span>
                  <span
                    className="px-2 py-0.5 rounded-sm text-[11px] font-medium"
                    style={{ background: subCol.bgColor, color: subCol.nameColor }}
                  >
                    {subCol.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 依赖卡列表 */}
      <div className="mb-5" data-testid="board-detail-deps">
        <h4 className="text-xs text-text-3 uppercase tracking-wide mb-2 font-semibold flex items-center gap-2">
          依赖卡
          <span className="bg-bg-subtle text-text-3 px-1.5 py-0.5 rounded-sm text-[10px] font-medium">
            {dependencies.length}
          </span>
        </h4>
        {dependencies.length === 0 ? (
          <div className="px-4 py-3 bg-bg-elevated border border-border rounded-md text-xs text-text-3">
            无依赖
          </div>
        ) : (
          <div className="px-3 py-2 bg-bg-elevated border border-border rounded-md">
            {dependencies.map((dep) => (
              <div
                key={dep.id}
                className="py-1.5 text-sm text-text-2"
              >
                → {shortCardId(dep.id)} · {dep.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详细信息折叠(8 冷字段) */}
      <details className="mt-4" data-testid="board-detail-fold">
        <summary className="text-sm text-text-2 cursor-pointer font-medium select-none">
          详细信息 ▾
        </summary>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1 mt-2 p-3 bg-bg-subtle border border-border rounded-md text-sm">
          <dt className="text-text-3">labels</dt>
          <dd className="text-text-1">
            {card.labels.length > 0 ? card.labels.join(', ') : '无'}
          </dd>
          <dt className="text-text-3">depends_on</dt>
          <dd className="text-text-1 font-mono text-xs">
            {card.depends_on.length > 0 ? card.depends_on.join(', ') : '[]'}
          </dd>
          <dt className="text-text-3">order_index</dt>
          <dd className="text-text-1 font-mono text-xs">
            {card.order_index ?? 'null'}
          </dd>
          <dt className="text-text-3">created_at</dt>
          <dd className="text-text-1 font-mono text-xs">{card.created_at}</dd>
          <dt className="text-text-3">updated_at</dt>
          <dd className="text-text-1 font-mono text-xs">{card.updated_at}</dd>
          <dt className="text-text-3">completed_at</dt>
          <dd className="text-text-1 font-mono text-xs">
            {card.completed_at ?? 'null'}
          </dd>
          <dt className="text-text-3">is_archived</dt>
          <dd className="text-text-1">{String(card.is_archived)}</dd>
          <dt className="text-text-3">parent_id</dt>
          <dd className="text-text-1 font-mono text-xs">{card.parent_id}</dd>
        </dl>
      </details>
    </div>
  )
}
