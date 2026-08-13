'use client'

/**
 * board chat 输入框(issue 07 / ADR-0029)
 *
 * 形态沿用旧 CardTranscriptInput:textarea + 发送按钮 + 快捷键。
 * 快捷键约定:
 * - Enter → 发送(主流 chat UX)
 * - Shift+Enter → 换行(保留多行输入能力)
 *
 * 新增:
 * - `disabled` prop(单 tab lock 时禁用)
 * - `placeholder` 由父组件传入(chat 模式 vs transcript 模式区别)
 *
 * 不发 transcript.yaml —— 由父组件决定走哪个 mutation。
 */

import { useState, useCallback, type KeyboardEvent, type ReactNode } from 'react'

export interface CardTranscriptInputProps {
  onSend: (content: string) => void | Promise<void>
  isPending?: boolean
  error?: string | null
  disabled?: boolean
  placeholder?: string
  testIdPrefix?: string
}

export function CardTranscriptInput({
  onSend,
  isPending = false,
  error = null,
  disabled = false,
  placeholder = '继续对话…',
  testIdPrefix = 'board-detail-transcript',
}: CardTranscriptInputProps) {
  const [value, setValue] = useState('')

  const canSend = value.trim().length > 0 && !isPending && !disabled

  const handleSend = useCallback(async () => {
    if (!canSend) return
    const content = value
    setValue('')
    await onSend(content)
  }, [canSend, value, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 直接发送;Shift+Enter 走默认行为(插入换行,保留多行输入)。
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div
      data-testid={`${testIdPrefix}`}
      className="mt-auto p-3 border border-border-strong rounded-md bg-bg-elevated"
    >
      <textarea
        data-testid={`${testIdPrefix}-textarea`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        // lock 时禁用(父传 disabled=true);首次发送(!meta)允许填内容触发
        // startMutation 启动 SDK session。button 仍受 canSend 控制表达"可发"语义。
        disabled={disabled || isPending}
        placeholder={placeholder}
        className="w-full border-none outline-none resize-none font-inherit text-sm text-text-1 bg-transparent min-h-[60px]"
      />
      <div
        data-testid={`${testIdPrefix}-controls`}
        className="flex items-center justify-between pt-1.5 border-t border-dashed border-border mt-1.5"
      >
        <div>
          <span className="text-text-3 text-xs">SDK session · 工具/权限/sub-agent 全开</span>
        </div>
        <button
          type="button"
          data-testid={`${testIdPrefix}-send`}
          onClick={() => void handleSend()}
          disabled={!canSend}
          className="px-3 py-1 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? '发送中…' : '发送'}
          {!isPending && (
            <span className="opacity-60 text-[11px] ml-1">↵</span>
          )}
        </button>
      </div>
      {error && (
        <div
          data-testid="board-chat-input-error"
          className="text-sm text-error bg-error/10 px-2 py-1 rounded-sm mt-1.5"
        >
          {error}
        </div>
      )}
    </div>
  )
}