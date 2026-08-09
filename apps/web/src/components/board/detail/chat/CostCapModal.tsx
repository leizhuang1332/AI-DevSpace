'use client'

/**
 * CostCapModal — 单 session cost cap ($5) 触发的 modal(ADR-0029 D8 决策 41)
 *
 * 4 选项(ADR-0029 决策 41 + ChatCostCapResolve enum):
 * - continue_once —— 继续本次 query,本次不计 cap
 * - continue_session —— 本 session 后续不再 cap
 * - pause —— 暂停当前 query
 * - new_session —— 关闭当前 session,新建一个
 *
 * `reason` 字段由父组件追加到 mutation args(本期 web 端只发固定 payload,
 * reason 通过 modal 描述展示)。
 */

import type { ReactNode } from 'react'
import type { ChatSessionCostCapResolve } from '@ai-devspace/shared'

export interface CostCapModalProps {
  costUsd: number
  capUsd?: number
  onResolve: (resolve: ChatSessionCostCapResolve['resolve']) => void
}

export function CostCapModal({
  costUsd,
  capUsd = 5,
  onResolve,
}: CostCapModalProps): ReactNode {
  return (
    <div
      data-testid="board-chat-cost-cap-modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-bg-elevated border border-border rounded-lg p-4 max-w-md w-full flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">💰</span>
          <h3 className="text-sm font-semibold flex-1 text-text-1">
            单 session cost 累计触顶
          </h3>
        </div>
        <p className="text-xs text-text-2">
          本 session 已累计 ${costUsd.toFixed(2)} USD(默认 cap ${capUsd})。下一步?
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="board-chat-cost-cap-continue-once"
            onClick={() => onResolve('continue_once')}
            className="px-3 py-2 text-xs rounded bg-brand text-white border border-brand hover:bg-brand-600"
          >
            继续本次 query(不计 cap)
          </button>
          <button
            type="button"
            data-testid="board-chat-cost-cap-continue-session"
            onClick={() => onResolve('continue_session')}
            className="px-3 py-2 text-xs rounded border border-border bg-bg-elevated text-text-1 hover:border-text-3"
          >
            本 session 后续不再 cap
          </button>
          <button
            type="button"
            data-testid="board-chat-cost-cap-pause"
            onClick={() => onResolve('pause')}
            className="px-3 py-2 text-xs rounded border border-border bg-bg-elevated text-text-1 hover:border-text-3"
          >
            暂停当前 query
          </button>
          <button
            type="button"
            data-testid="board-chat-cost-cap-new-session"
            onClick={() => onResolve('new_session')}
            className="px-3 py-2 text-xs rounded border border-error text-error hover:bg-error/10"
          >
            关闭 session + 新建
          </button>
        </div>
      </div>
    </div>
  )
}