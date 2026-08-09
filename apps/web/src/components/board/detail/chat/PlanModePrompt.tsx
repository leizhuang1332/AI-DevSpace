'use client'

/**
 * PlanModePrompt — plan review modal(ADR-0029 D8 决策 35-37)
 *
 * 形态:
 * - 顶部:plan markdown 渲染(react-markdown + remark-gfm)
 * - 底部:[Accept] [Modify] [Reject]
 * - Modify → 子输入框 + 发送
 *
 * 本期先实现 3 选项 + Modify 子输入;resolve 回调由父组件调 mutation。
 */

import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface PlanModePromptProps {
  planMarkdown: string
  onAccept: () => void
  onReject: (reason: string) => void
  onModify: (newPrompt: string) => void
}

export function PlanModePrompt({
  planMarkdown,
  onAccept,
  onReject,
  onModify,
}: PlanModePromptProps): ReactNode {
  const [showModify, setShowModify] = useState(false)
  const [modifyText, setModifyText] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  const handleModifySubmit = (): void => {
    const text = modifyText.trim()
    if (!text) return
    onModify(text)
    setShowModify(false)
    setModifyText('')
  }

  return (
    <div
      data-testid="board-chat-plan-modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-bg-elevated border border-border rounded-lg p-4 max-w-2xl w-full max-h-[80vh] flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🛡️</span>
          <h3 className="text-sm font-semibold flex-1 text-text-1">Plan review</h3>
        </div>
        <div
          data-testid="board-chat-plan-markdown"
          className="prose prose-sm max-w-none text-xs text-text-2 overflow-auto max-h-96 px-2 py-1.5 bg-bg-subtle rounded"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{planMarkdown}</ReactMarkdown>
        </div>
        {showModify ? (
          <div className="flex flex-col gap-2">
            <textarea
              data-testid="board-chat-plan-modify-input"
              value={modifyText}
              onChange={(e) => setModifyText(e.target.value)}
              placeholder="描述你想修改的地方"
              className="text-xs border border-border rounded px-2 py-1.5 bg-bg-elevated text-text-1 min-h-[60px]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="board-chat-plan-modify-submit"
                onClick={handleModifySubmit}
                disabled={modifyText.trim().length === 0}
                className="px-3 py-1 text-xs rounded bg-brand text-white disabled:opacity-50"
              >
                提交修改
              </button>
              <button
                type="button"
                data-testid="board-chat-plan-modify-cancel"
                onClick={() => setShowModify(false)}
                className="px-3 py-1 text-xs rounded border border-border bg-bg-elevated text-text-2"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              data-testid="board-chat-plan-reject-reason"
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="(可选)拒绝理由"
              className="text-xs border border-border rounded px-2 py-1 bg-bg-elevated text-text-1"
            />
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                data-testid="board-chat-plan-accept"
                onClick={onAccept}
                className="px-3 py-1.5 text-xs rounded bg-brand text-white border border-brand hover:bg-brand-600"
              >
                Accept
              </button>
              <button
                type="button"
                data-testid="board-chat-plan-modify"
                onClick={() => setShowModify(true)}
                className="px-3 py-1.5 text-xs rounded border border-border bg-bg-elevated text-text-1 hover:border-text-3"
              >
                Modify
              </button>
              <button
                type="button"
                data-testid="board-chat-plan-reject"
                onClick={() => onReject(rejectReason.trim())}
                className="px-3 py-1.5 text-xs rounded border border-error text-error hover:bg-error/10 ml-auto"
              >
                Reject
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}