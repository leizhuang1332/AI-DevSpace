'use client'

import { useEffect } from 'react'

export interface ToastItem {
  id: string
  message: string
  tone: 'info' | 'warn' | 'err'
  /** null = 不自动消失(用户手动关) */
  durationMs: number | null
}

const TONE_CLASS: Record<ToastItem['tone'], string> = {
  info: 'bg-brand-50 text-brand-700 border-brand',
  warn: 'bg-[#fef3c7] text-[#92400e] border-[#92400e]',
  err: 'bg-[#fee2e2] text-[#991b1b] border-[#991b1b]',
}

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): JSX.Element {
  useEffect(() => {
    if (item.durationMs === null) return
    const t = setTimeout(onDismiss, item.durationMs)
    return () => clearTimeout(t)
  }, [item.durationMs, onDismiss])

  return (
    <div
      data-testid={`toast-${item.id}`}
      data-tone={item.tone}
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 px-4 py-2 rounded-md border shadow-sm ${TONE_CLASS[item.tone]}`}
    >
      <span className="text-sm flex-1">{item.message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={onDismiss}
        className="text-current opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}
