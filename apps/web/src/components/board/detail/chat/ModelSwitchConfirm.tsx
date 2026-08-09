'use client'

/**
 * ModelSwitchConfirm — 切昂贵 model 弹 confirm(ADR-0029 D8 决策 40)
 *
 * 形态:
 * - 提示 "Sonnet → Opus,单价比 X 倍,确认?"
 * - [取消] [继续]
 *
 * 注:`expectedCostMultiplier` 由父组件计算(本期写死 sonnet→opus = 5)。
 */

import type { ReactNode } from 'react'

export interface ModelSwitchConfirmProps {
  from: string
  to: string
  costMultiplier?: number
  onConfirm: () => void
  onCancel: () => void
}

export function ModelSwitchConfirm({
  from,
  to,
  costMultiplier = 5,
  onConfirm,
  onCancel,
}: ModelSwitchConfirmProps): ReactNode {
  return (
    <div
      data-testid="board-chat-model-switch-confirm"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-bg-elevated border border-border rounded-lg p-4 max-w-md w-full flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">⚠️</span>
          <h3 className="text-sm font-semibold flex-1 text-text-1">切昂贵 model?</h3>
        </div>
        <p className="text-xs text-text-2">
          从 <code className="font-mono">{from}</code> 切到{' '}
          <code className="font-mono">{to}</code>,单价比当前{' '}
          <strong>{costMultiplier}倍</strong>。确认?
        </p>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            data-testid="board-chat-model-switch-confirm-cancel"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-border bg-bg-elevated text-text-1 hover:border-text-3"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="board-chat-model-switch-confirm-ok"
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded bg-brand text-white border border-brand hover:bg-brand-600 ml-auto"
          >
            继续
          </button>
        </div>
      </div>
    </div>
  )
}