'use client'

/**
 * board 卡片详情页 — 右栏默认态 CardSideProperty(issue 08 / ADR-0027 D5.1)
 *
 * 视觉对照基线:`docs/design/pages/board-detail-final.html` .side-default 块。
 *
 * 结构:
 * - 顶部 [💬 在对话中打开] 按钮(toggle 触发,展开 transcript)
 * - 属性表 8 行(status / priority / assignee / labels 显示真实值;
 *   workflow / dev-context / due-date / repeat 显示「未绑定」占位)
 * - 关系区(阻塞于 = filterDependencies / 阻塞 = filterBlockedBy / 相关议题 = 「无」)
 * - 创建于 / 更新于 meta block
 *
 * status 行 select → onStatusChange(走 PATCH → Guard → 可能弹 Modal)
 */

import type { TaskCard, TaskCardStatusT } from '@ai-devspace/shared'
import {
  PRIORITY_BADGE,
  SOURCE_LABEL,
  assigneeInitial,
  filterBlockedBy,
  filterDependencies,
  formatRelativeTime,
  shortCardId,
  STATUS_COLUMNS,
  STATUS_COLUMN_ORDER,
} from '@/lib/board'

export interface CardSidePropertyProps {
  card: TaskCard
  /** 全量卡片(关系区派生用) */
  cards: TaskCard[]
  /** 切换到 transcript 展开态 */
  onToggleTranscript: () => void
  /** status 变更触发 */
  onStatusChange?: (newStatus: TaskCardStatusT) => void
}

export function CardSideProperty({
  card,
  cards,
  onToggleTranscript,
  onStatusChange,
}: CardSidePropertyProps) {
  const statusCol = STATUS_COLUMNS[card.status]
  const priorityBadge = card.priority ? PRIORITY_BADGE[card.priority] : null
  const dependencies = filterDependencies(cards, card)
  const blockedBy = filterBlockedBy(cards, card.id)

  return (
    <div
      data-testid="board-detail-side-property"
      className="p-4 bg-bg-elevated flex flex-col gap-3 min-w-0"
    >
      {/* [💬 在对话中打开] toggle 按钮 */}
      <button
        type="button"
        data-testid="board-detail-toggle-transcript"
        onClick={onToggleTranscript}
        className="w-full px-3 py-3 bg-bg-elevated border border-border-strong rounded-md flex items-center justify-center gap-2 text-sm font-medium text-text-1 hover:bg-bg-hover hover:border-text-3 transition-all"
      >
        <span className="text-brand">💬</span>
        <span>在对话中打开</span>
      </button>

      {/* 属性表 */}
      <div data-testid="board-detail-prop-block" className="mt-4">
        <h3 className="text-sm font-semibold text-text-1 mb-3 pb-2 border-b border-border">
          属性
        </h3>

        {/* status 行(可改) */}
        <div
          data-testid="board-detail-prop-status"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>●</span>状态
          </div>
          <div className="flex-1 flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: statusCol.dotColor }}
            />
            {onStatusChange ? (
              <select
                data-testid="board-detail-prop-status-select"
                value={card.status}
                onChange={(e) => onStatusChange(e.target.value as TaskCardStatusT)}
                className="bg-transparent font-medium cursor-pointer outline-none"
                style={{ color: statusCol.nameColor }}
              >
                {STATUS_COLUMN_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_COLUMNS[s].label}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ color: statusCol.nameColor }} className="font-medium">
                {statusCol.label}
              </span>
            )}
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>

        {/* priority 行 */}
        <div
          data-testid="board-detail-prop-priority"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>▮</span>优先级
          </div>
          <div className="flex-1 flex items-center gap-2">
            <span
              className="font-semibold"
              style={priorityBadge ? { color: priorityBadge.text } : { color: 'var(--text-3)' }}
            >
              {priorityBadge ? priorityBadge.label : '无'}
            </span>
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>

        {/* assignee 行 */}
        <div
          data-testid="board-detail-prop-assignee"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>👤</span>负责人
          </div>
          <div className="flex-1 flex items-center gap-2">
            {card.assignee && (
              <span
                className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-white text-[9px] font-semibold"
                style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}
              >
                {assigneeInitial(card.assignee)}
              </span>
            )}
            <span className="text-text-1">{card.assignee ?? '未指派'}</span>
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>

        {/* labels 行 */}
        <div
          data-testid="board-detail-prop-labels"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>🏷</span>标签
          </div>
          <div className="flex-1 flex items-center gap-1 flex-wrap">
            {card.labels.length > 0 ? (
              card.labels.map((label) => (
                <span
                  key={label}
                  className="text-[11px] px-1.5 py-0.5 bg-[#e0e7ff] text-[#3730a3] rounded-sm font-medium"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-text-3 text-xs">无</span>
            )}
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>

        {/* workflow 行(未绑定占位) */}
        <div
          data-testid="board-detail-prop-workflow"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>🧬</span>工作流
          </div>
          <div className="flex-1 flex items-center gap-2">
            <span className="text-text-3">未绑定</span>
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>

        {/* dev-context 行(未绑定占位) */}
        <div
          data-testid="board-detail-prop-dev-context"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>⚙</span>开发上下文
          </div>
          <div className="flex-1 flex items-center gap-2">
            <span className="text-text-3">未绑定</span>
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>

        {/* due-date 行(占位) */}
        <div
          data-testid="board-detail-prop-due-date"
          className="flex items-center gap-3 py-2 text-sm border-b border-border"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>📅</span>截止日期
          </div>
          <div className="flex-1 flex items-center gap-2">
            <span className="text-text-3 text-xs">无</span>
            <span className="ml-auto text-text-3 text-xs">📅</span>
          </div>
        </div>

        {/* repeat 行(占位) */}
        <div
          data-testid="board-detail-prop-repeat"
          className="flex items-center gap-3 py-2 text-sm"
        >
          <div className="flex items-center gap-2 text-text-3 text-xs w-[84px] shrink-0">
            <span>↻</span>重复
          </div>
          <div className="flex-1 flex items-center gap-2">
            <span className="text-text-1">不重复</span>
            <span className="ml-auto text-text-3 text-xs">▾</span>
          </div>
        </div>
      </div>

      {/* 关系区 */}
      <div
        data-testid="board-detail-rel-block"
        className="mt-5 pt-3 border-t border-border"
      >
        <h3 className="text-sm font-semibold text-text-1 mb-3">关系</h3>

        {/* 阻塞于 */}
        <div
          data-testid="board-detail-rel-blocked-by"
          className="flex items-center gap-3 py-2 text-sm text-text-2 border-b border-border"
        >
          <div className="text-text-3 w-[90px] shrink-0">⚠ 阻塞于</div>
          <div className="flex-1 text-text-2">
            {dependencies.length > 0 ? (
              dependencies.map((d) => (
                <span key={d.id} className="text-text-2">
                  {shortCardId(d.id)} · {d.title}
                </span>
              ))
            ) : (
              <span className="text-text-3 text-xs">无</span>
            )}
          </div>
        </div>

        {/* 阻塞 */}
        <div
          data-testid="board-detail-rel-blocks"
          className="flex items-center gap-3 py-2 text-sm text-text-2 border-b border-border"
        >
          <div className="text-text-3 w-[90px] shrink-0">⛔ 阻塞</div>
          <div className="flex-1 text-text-2">
            {blockedBy.length > 0 ? (
              blockedBy.map((b) => (
                <span key={b.id} className="text-text-2">
                  {shortCardId(b.id)} · {b.title}
                </span>
              ))
            ) : (
              <span className="text-text-3 text-xs">无</span>
            )}
          </div>
        </div>

        {/* 相关议题 */}
        <div
          data-testid="board-detail-rel-related"
          className="flex items-center gap-3 py-2 text-sm text-text-2"
        >
          <div className="text-text-3 w-[90px] shrink-0">🔗 相关议题</div>
          <div className="flex-1 text-text-3 text-xs">无</div>
        </div>
      </div>

      {/* 创建 / 更新 meta */}
      <div
        data-testid="board-detail-meta-block"
        className="mt-4 pt-3 border-t border-border text-xs text-text-3"
      >
        <div className="flex justify-between py-0.5">
          <span>创建于</span>
          <span>{formatRelativeTime(card.created_at)}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>更新于</span>
          <span>{formatRelativeTime(card.updated_at)}</span>
        </div>
      </div>
    </div>
  )
}
