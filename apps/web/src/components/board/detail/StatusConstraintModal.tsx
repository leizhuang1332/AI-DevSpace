'use client'

/**
 * board 卡片详情页 — StatusConstraintModal(issue 08 / ADR-0025 D2 + D5)
 *
 * 当 PATCH /cards/:cardId/status 返回 `{ok:false, conflicts}` 时弹此 Modal。
 *
 * 三选项(ADR-0025 D2):
 * - A 强制切换 → onForceSwitch(再 PATCH override=true,落盘 + 写 overrides.log)
 * - B 先调整子卡 → onAdjustChildren(回 board section 让用户推子卡)
 * - C 取消 → onCancel(不变更)
 *
 * conflicts 来自 board.ts 的 `{ok:false, conflicts:[{card_id, card_status, rule}]}`。
 * rule → 中文描述(便于用户看懂冲突原因)。
 */

import type { RequirementStatusT, TaskCardStatusT } from '@ai-devspace/shared'

/** 冲突项(镜像 agent StatusConstraintGuard.ConstraintConflict)。 */
export interface ConstraintConflictItem {
  card_id: string
  card_status: TaskCardStatusT
  rule:
    | 'no_backlog_for_implementing'
    | 'no_in_progress_for_submitting'
    | 'all_done_for_parent_done'
}

export interface StatusConstraintModalProps {
  open: boolean
  conflicts: ConstraintConflictItem[]
  /** 父 Requirement 当前 status(implementing/submitting/done) */
  parentStatus: RequirementStatusT | string
  /** 用户想切到的 status(触发冲突) */
  pendingStatus: TaskCardStatusT | string
  onForceSwitch: () => void
  onAdjustChildren: () => void
  onCancel: () => void
}

const RULE_LABEL: Record<ConstraintConflictItem['rule'], string> = {
  no_backlog_for_implementing: '父 status=implementing 要求无 backlog 卡',
  no_in_progress_for_submitting: '父 status=submitting 要求无 in_progress 卡',
  all_done_for_parent_done: '父 status=done 要求所有非 archived 卡 = done',
}

export function StatusConstraintModal({
  open,
  conflicts,
  parentStatus,
  pendingStatus,
  onForceSwitch,
  onAdjustChildren,
  onCancel,
}: StatusConstraintModalProps) {
  if (!open) return null

  return (
    <div
      data-testid="board-status-constraint-modal"
      data-open={open ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onCancel}
    >
      <div
        data-testid="board-status-constraint-modal-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[480px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 flex flex-col gap-4">
          <header className="flex items-center gap-2">
            <span className="text-warning text-lg">⚠</span>
            <h2 className="text-lg font-semibold text-text-1">状态冲突</h2>
          </header>

          <p className="text-sm text-text-2">
            将卡片切到 <span className="font-semibold text-text-1">{pendingStatus}</span>{' '}
            与父 Requirement 状态 <span className="font-semibold text-text-1">{parentStatus}</span>{' '}
            冲突。请选择如何处理:
          </p>

          {/* conflicts 列表 */}
          {conflicts.length > 0 && (
            <div
              data-testid="board-status-constraint-conflicts"
              className="border border-border rounded-md bg-bg-subtle p-3 flex flex-col gap-1.5 max-h-[200px] overflow-auto"
            >
              {conflicts.map((c, idx) => (
                <div
                  key={`${c.card_id}-${idx}`}
                  data-testid="board-status-constraint-conflict"
                  className="text-xs text-text-2"
                >
                  <span className="font-mono text-text-3">{c.card_id.slice(-4)}</span>
                  {' · '}
                  <span>当前 {c.card_status}</span>
                  <span className="block text-text-3">{RULE_LABEL[c.rule]}</span>
                </div>
              ))}
            </div>
          )}

          {/* 三选项 */}
          <div className="flex flex-col gap-2 mt-2">
            <button
              type="button"
              data-testid="board-status-modal-force"
              onClick={(e) => {
                e.stopPropagation()
                onForceSwitch()
              }}
              className="px-3 py-2 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 text-left"
            >
              强制切换
              <span className="block text-[11px] font-normal opacity-80">
                接受 override,把父 status 写下去(子卡片不变)
              </span>
            </button>
            <button
              type="button"
              data-testid="board-status-modal-adjust"
              onClick={(e) => {
                e.stopPropagation()
                onAdjustChildren()
              }}
              className="px-3 py-2 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle text-left"
            >
              先调整子卡
              <span className="block text-[11px] font-normal text-text-3">
                跳转 board 推进子卡片状态后再切
              </span>
            </button>
            <button
              type="button"
              data-testid="board-status-modal-cancel"
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              className="px-3 py-2 rounded-md text-sm font-medium bg-bg-elevated text-text-2 border border-border-strong hover:bg-bg-subtle text-left"
            >
              取消
              <span className="block text-[11px] font-normal text-text-3">
                不变更,关闭
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
