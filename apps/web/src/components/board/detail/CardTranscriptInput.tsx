'use client'

/**
 * board 卡片详情页 — transcript 输入框(issue 08 / ADR-0028 D5)
 *
 * 视觉对照基线:`docs/design/pages/board-detail-final.html` .input-row。
 *
 * 行为:
 * - textarea(多行,resizable)
 * - ⌘+↵ / Ctrl+↵ → 发送(onSend(content))
 * - 📎 引用 Run 占位(本期静态提示,不展开 picker)
 * - 发送按钮(点击也触发)
 * - placeholder:「继续对话…只能描述/提问,不可发 Run」(守门 ADR-0028 D2)
 *
 * 守门:本组件**只发文本消息**,不渲染 [+ Skill] [+ Run] 按钮(对比 analyzing section 有)。
 * 发送 → onSend → useSendTranscriptMessage → 成功后清空 textarea。
 */

import { useState, useCallback, type KeyboardEvent } from 'react'

export interface CardTranscriptInputProps {
  /** 发送消息回调(返回 Promise 以支持发送中 loading) */
  onSend: (content: string) => void | Promise<void>
  /** 发送中(禁用按钮 + 文案) */
  isPending?: boolean
  /** 发送失败提示 */
  error?: string | null
}

export function CardTranscriptInput({
  onSend,
  isPending = false,
  error = null,
}: CardTranscriptInputProps) {
  const [value, setValue] = useState('')

  const canSend = value.trim().length > 0 && !isPending

  const handleSend = useCallback(async () => {
    if (!canSend) return
    const content = value
    setValue('')
    await onSend(content)
  }, [canSend, value, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // ⌘+↵ (Mac) 或 Ctrl+↵ (Win/Linux) 发送
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div
      data-testid="board-detail-transcript-input-row"
      className="mt-auto p-3 border border-border-strong rounded-md bg-bg-elevated"
    >
      <textarea
        data-testid="board-detail-transcript-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        placeholder="继续对话…只能描述/提问,不可发 Run"
        className="w-full border-none outline-none resize-none font-inherit text-sm text-text-1 bg-transparent min-h-[60px]"
      />
      <div
        data-testid="board-detail-transcript-input-controls"
        className="flex items-center justify-between pt-1.5 border-t border-dashed border-border mt-1.5"
      >
        <div>
          <span className="text-text-3 text-xs">📎 引用 Run(输入 #run-id)</span>
        </div>
        <button
          type="button"
          data-testid="board-detail-transcript-send"
          onClick={() => void handleSend()}
          disabled={!canSend}
          className="px-3 py-1 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? '发送中…' : '发送'}
          {!isPending && (
            <span className="opacity-60 text-[11px] ml-1">⌘+↵</span>
          )}
        </button>
      </div>
      {error && (
        <div className="text-sm text-error bg-error/10 px-2 py-1 rounded-sm mt-1.5">
          {error}
        </div>
      )}
    </div>
  )
}
