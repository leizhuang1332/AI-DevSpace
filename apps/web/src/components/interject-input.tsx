'use client'

/**
 * InterjectInput 组件 — ANALYZING 工位主区底部"插话输入条"(ADR-0013 D2 ②)
 *
 * 视觉对照基线:docs/design/pages/11h-A-zone-multisession-tabs.html 底部插话条(原型未给具体形态,本组件参考 EXECUTING / DRAFTING 工位风格)
 *
 * 职责:
 * - 提供输入框 + [提交] 按钮,让用户在 AI 解析过程中补充上下文 / 反向提问
 * - 提交触发 `onSubmit(text)` 回调 —— 由父组件(analyzing-zone)决定行为:
 *     1. POST /api/requirements/<id>/analysis/interject { text, session_id }
 *     2. 清空输入框
 *     3. SSE 推送新 chunk 自动追加到打字机流(由父组件的 useEffect 订阅实现)
 *
 * 设计要点:
 * - 'use client':输入框是客户端交互
 * - 受控输入:组件内部维护 text 状态;父组件无需关心文字内容,只在提交时收 text
 * - disabled 逻辑:text 为空 / 仅空白 / 提交中时按钮不可点
 * - submitting 状态:防止重复提交(防抖替代方案)
 * - placeholder 文案来自 props,便于测试与上下文定制
 */

import { useCallback, useState, type KeyboardEvent } from 'react'

export interface InterjectInputProps {
  /** 提交时触发 —— 父组件接 text 后发请求 + 清空 + 处理 SSE */
  onSubmit: (text: string) => void
  /** 输入框 placeholder(便于父组件按工位语境定制) */
  placeholder?: string
  /** 提交进行中时按钮显示的文案(禁用重复提交) */
  submittingLabel?: string
  /** 父组件可注入:当下正在提交 → 按钮 disabled;允许父组件跨组件表达"提交流水" */
  isSubmitting?: boolean
}

export function InterjectInput({
  onSubmit,
  placeholder = '💬 补充上下文或反向提问 AI(Enter 提交,Shift+Enter 换行)',
  submittingLabel = '提交中…',
  isSubmitting = false,
}: InterjectInputProps) {
  const [text, setText] = useState('')

  // trim 后为空 → 视为不可提交
  const trimmed = text.trim()
  const canSubmit = trimmed.length > 0 && !isSubmitting

  const submit = useCallback(() => {
    if (!canSubmit) return
    // 提交前先清空(乐观 UI),再回调父组件
    const submitted = trimmed
    setText('')
    onSubmit(submitted)
  }, [canSubmit, trimmed, onSubmit])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 提交(不带 Shift);Shift+Enter 换行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  return (
    <div
      data-testid="interject-input"
      data-submitting={isSubmitting ? 'true' : 'false'}
      className="bg-bg-elevated border border-border rounded-lg px-4 py-3 flex items-start gap-3"
    >
      <span className="text-xl mt-1" aria-hidden>
        💬
      </span>
      <div className="flex-1 min-w-0">
        <textarea
          data-testid="interject-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={isSubmitting}
          aria-label="插话输入框"
          className="w-full resize-none text-sm text-text-1 bg-bg-subtle border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand placeholder:text-text-3"
        />
        <div className="mt-1 text-xs text-text-3 flex items-center justify-between">
          <span>
            <kbd className="font-mono bg-bg-subtle border border-border px-1 rounded">Enter</kbd>{' '}
            提交 ·{' '}
            <kbd className="font-mono bg-bg-subtle border border-border px-1 rounded">Shift</kbd>+
            <kbd className="font-mono bg-bg-subtle border border-border px-1 rounded">Enter</kbd>{' '}
            换行
          </span>
          <span data-testid="interject-char-count" className="font-mono">
            {text.length}
          </span>
        </div>
      </div>
      <button
        type="button"
        data-testid="interject-submit-btn"
        onClick={submit}
        disabled={!canSubmit}
        className="h-9 px-4 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:bg-bg-subtle disabled:text-text-3 disabled:cursor-not-allowed transition-colors flex-shrink-0"
      >
        {isSubmitting ? submittingLabel : '提交插话'}
      </button>
    </div>
  )
}
