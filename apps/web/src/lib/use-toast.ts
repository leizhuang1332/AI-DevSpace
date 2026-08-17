'use client'

/**
 * useToast —— 简易 Toast hook(issue 03 / ADR-0036 D4)
 *
 * 设计要点:
 * - 仅前端状态(无 SSE / 后端通道),沿用 [ADR-0022 D4.4](0022-analyzing-history-floating-action-button.md) 决策 94「克制,在场」
 * - `push(message, tone)` 返回的 `items` 由 `<ToastHost>` 渲染(本仓 `components/toast-host.tsx`)
 * - 序列 id 自增,避免 React key 冲突
 * - 默认 durationMs=3000(3s 静态);保留 null = 不自动消失(本仓暂无用例,沿用接口对称)
 *
 * 历史:
 * - 原内联在 `components/analyzing-zone.tsx` L1182-1196(分析区专用)
 * - issue 03 后 board section 复用,提取到 `lib/use-toast.ts` 共享
 */

import { useCallback, useRef, useState } from 'react'
import type { ToastItem } from '@/components/toast'

export interface UseToastResult {
  items: ToastItem[]
  push: (message: string, tone: ToastItem['tone']) => void
  dismiss: (id: string) => void
}

export function useToast(): UseToastResult {
  const [items, setItems] = useState<ToastItem[]>([])
  const seqRef = useRef(0)
  const push = useCallback(
    (message: string, tone: ToastItem['tone']) => {
      const id = `toast-${seqRef.current++}`
      setItems((prev) => [...prev, { id, message, tone, durationMs: 3000 }])
    },
    [],
  )
  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])
  return { items, push, dismiss }
}