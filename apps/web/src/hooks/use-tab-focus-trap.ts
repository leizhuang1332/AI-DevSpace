/**
 * useTabFocusTrap —— 弹窗内的 Tab/Shift+Tab 焦点循环
 *
 * 行为:
 * - 把焦点困在 `containerRef.current` 内的可聚焦元素列表中
 * - 末元素按 Tab → 回到首元素;首元素按 Shift+Tab → 跳到末元素
 * - 若当前焦点不在容器内(漏到 backdrop),按 Tab → 首元素,Shift+Tab → 末元素
 * - 跳过 `disabled` / `hidden` 元素(与 attach-repos-dialog 既有约定一致)
 * - Escape **不**在本 hook 处理 —— store 已经有全局 keydown 兜底
 *
 * 来源:attach-repos-dialog.tsx:139-178 (issue 01 验收 #12) 抽出来共用。
 * 现在用于 new-requirement-modal.tsx (issue 03 ticket)。后续有弹窗需求
 * 直接 import 即可。
 *
 * selector 与 「可聚焦」 判定沿用既有 query 字符串,不要换实现 —— 已经
 * 被 8 个 vitest 单测断言过。
 */
import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useTabFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const dialog = containerRef.current
      if (!dialog) return
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('hidden'))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, containerRef])
}