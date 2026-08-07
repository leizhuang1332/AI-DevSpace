'use client'

/**
 * board toolbar — issue 07 / ADR-0027 D3 + PRD Round 2 UI 决议
 *
 * 视觉对照基线:`docs/design/pages/board-color-options.html` .toolbar 规则。
 *
 * 三段式布局(Linear 多段):
 * - 左:`[REF-XX Board ▾]` 视图切换 chip(本期静态显示 requirementId,▾ 不响应)
 *   + 4 filter chips(全部 / 我的 / 高优先级 / PRD 拆;active = brand-50/brand-600)
 * - 右:`[+ 新任务]` 按钮(触发 NewTaskModal)+ `[+ 从 PRD 拆]` 按钮
 *   (issue 08 实装:触发 SplitFromPrdModal → POST /split-from-prd)
 *
 * Filter / Display 全走 Cmd+K 命令面板(本期 chips 是快捷入口,不接命令面板)。
 */

import {
  BOARD_FILTERS,
  BOARD_FILTER_LABEL,
  type BoardFilter,
} from '@/lib/board'

export interface BoardToolbarProps {
  requirementId: string
  filter: BoardFilter
  onFilterChange: (filter: BoardFilter) => void
  /** `[+ 新任务]` 按钮触发(打开 NewTaskModal) */
  onNewTask: () => void
  /** `[+ 从 PRD 拆]` 触发(issue 08:打开 SplitFromPrdModal) */
  onSplitFromPrd?: () => void
}

export function BoardToolbar({
  requirementId,
  filter,
  onFilterChange,
  onNewTask,
  onSplitFromPrd,
}: BoardToolbarProps) {
  return (
    <div
      data-testid="board-toolbar"
      data-requirement-id={requirementId}
      className="flex items-center gap-3 py-3 px-4 border-b border-border bg-bg-elevated"
    >
      {/* 左:视图切换 + filter chips */}
      <div className="flex items-center gap-2">
        <div
          data-testid="board-view-chip"
          className="flex items-center gap-2 px-2.5 py-1 border border-border-strong rounded-md text-sm font-medium text-text-1 bg-bg-elevated"
        >
          {requirementId} Board
          <span className="text-text-3 text-[10px]">▾</span>
        </div>
        <div
          data-testid="board-filter-chips"
          className="flex gap-1 ml-2"
        >
          {BOARD_FILTERS.map((f) => {
            const active = f === filter
            return (
              <button
                key={f}
                type="button"
                data-testid={`board-filter-chip-${f}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => onFilterChange(f)}
                className={`px-2.5 py-1 text-sm rounded-md cursor-pointer border ${
                  active
                    ? 'bg-brand-50 text-brand-600 font-medium border-transparent'
                    : 'text-text-2 border-transparent hover:bg-bg-hover'
                }`}
              >
                {BOARD_FILTER_LABEL[f]}
              </button>
            )
          })}
        </div>
      </div>

      {/* 右:操作按钮 */}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          data-testid="board-new-task"
          onClick={onNewTask}
          className="px-3 py-1 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          + 新任务
        </button>
        <button
          type="button"
          data-testid="board-split-from-prd"
          onClick={onSplitFromPrd}
          disabled={!onSplitFromPrd}
          title={onSplitFromPrd ? '从 PRD 智能拆分卡片' : '即将上线'}
          aria-disabled={!onSplitFromPrd ? 'true' : 'false'}
          className={`px-3 py-1 rounded-md text-sm font-medium border border-brand ${
            onSplitFromPrd
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-brand text-white opacity-50 cursor-not-allowed'
          }`}
        >
          + 从 PRD 拆
        </button>
      </div>
    </div>
  )
}
