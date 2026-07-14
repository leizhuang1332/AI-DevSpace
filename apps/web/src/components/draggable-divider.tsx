'use client'

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

/**
 * 可拖拽水平分割条(issue 04 验收 #3 #4 #6 + 隐式可访问性)
 *
 * 视觉对照基线:`docs/design/pages/19-final-drafting.html` 的 `.split-resizer`
 *
 * 行为契约:
 * - hover → cursor:row-resize(Tailwind)
 * - mousedown → 进入拖拽态;document 监听 mousemove / mouseup
 * - 拖拽过程中,mousemove 把 (clientY) 转给父组件的 `onRatioChange(ratio)`,
 *   父组件拿到 ratio 后再 clamp(见 `clampSplitRatio`)
 * - mouseup → 退出拖拽态,清理监听
 * - touchstart / touchmove / touchend 同理(移动端)
 * - 键盘:role="separator" + aria-orientation + aria-valuenow;
 *   ↑/↓ ±1%、PageUp/PageDown ±5%、Home → min、End → max
 *
 * 设计要点:
 * - 本组件只发 ratio(已转好);不持有 ratio state。父组件持有真正的 ratio,
 *   拿到本组件的 ratio 后用 `clampSplitRatio` 二次裁剪,然后 setState。
 * - 鼠标 / 触摸事件绑在 `document` 而非自身:用户拖动时鼠标会移出 6px 高的
 *   目标元素,绑自身会丢 move 事件。
 * - 拖拽中设置 body.user-select = 'none',防止文本选中破坏拖拽手感;
 *   抬起后恢复。
 * - **容器高度由父组件通过 prop 注入**(无需 ref / 闭包耦合),保证本组件纯
 *   受控。
 */

export interface DraggableDividerProps {
  /**
   * 拖拽开始的回调,**带上初始 clientY**:
   * 这样父组件能立刻知道"拖拽起点 = (startClientY, currentRatio)",
   * 后续 mousemove 的 clientY 可以换算 deltaRatio。
   *
   * 关键:onDragStart 拿到的 clientY 必须与 pointerdown 时的 clientY 一致,
   * 否则第一次 mousemove 会出现 1-tick 滞后(把"起点"误当成"上一帧")。
   */
  onDragStart: (startClientY: number) => void
  /**
   * 拖拽中把"绝对 clientY"映射成 ratio 的回调。
   * 父组件自己持有 (startClientY, startRatio) 上下文,据此算出新 ratio。
   */
  onDragClientY: (clientY: number) => void
  /** 拖拽结束的回调(用于父组件清 dragStartRef / 持久化) */
  onDragEnd: () => void
  /** 当前 PRD 占比 (0-1);仅用于键盘操作 & aria-valuenow */
  ratio: number
  /** 键盘 ↑/↓ / PageUp/PageDown 改变 ratio 的回调 */
  onRatioChangeBy: (delta: number) => void
  /** 当前 ratio 的最小值(用于 aria-valuemin);父组件根据容器高度算出 */
  minRatio: number
  /** 当前 ratio 的最大值(用于 aria-valuemax);父组件根据容器高度算出 */
  maxRatio: number
  /** 测试用 testid;默认 `split-resizer` */
  testId?: string
  /** 可选的 aria-label */
  ariaLabel?: string
}

export function DraggableDivider({
  onDragStart,
  onDragClientY,
  onDragEnd,
  onRatioChangeBy,
  ratio,
  minRatio,
  maxRatio,
  testId = 'split-resizer',
  ariaLabel = '拖拽调整上下比例',
}: DraggableDividerProps) {
  /** 当前是否处于拖拽态(避免 release 之后继续响应 move) */
  const draggingRef = useRef(false)

  /** 拖拽中 body 的 user-select 状态,release 时恢复 */
  const previousUserSelectRef = useRef<string | null>(null)

  // -------------------------------------------------------------------------
  // 鼠标 / 触摸拖拽
  // -------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // 仅响应主键(左键 / 单指触屏);右键 / 中键忽略
      if (e.button !== 0) return
      draggingRef.current = true
      // 防止文本选中
      const body = document.body
      previousUserSelectRef.current = body.style.userSelect
      body.style.userSelect = 'none'

      // 通知父组件拖拽开始,**带上本次 pointerdown 的 clientY**;
      // 这样父组件可以从第一次 mousemove 起就准确算出 deltaRatio,
      // 没有"首帧 lag"(修复 code review Spec AC #4 反馈)。
      onDragStart(e.clientY)

      const handleMove = (ev: MouseEvent | TouchEvent) => {
        if (!draggingRef.current) return
        const clientY =
          'touches' in ev && ev.touches.length > 0
            ? ev.touches[0].clientY
            : (ev as MouseEvent).clientY
        onDragClientY(clientY)
      }

      const handleUp = () => {
        draggingRef.current = false
        document.body.style.userSelect = previousUserSelectRef.current ?? ''
        previousUserSelectRef.current = null
        document.removeEventListener('mousemove', handleMove)
        document.removeEventListener('mouseup', handleUp)
        document.removeEventListener('touchmove', handleMove)
        document.removeEventListener('touchend', handleUp)
        onDragEnd()
      }

      document.addEventListener('mousemove', handleMove)
      document.addEventListener('mouseup', handleUp)
      document.addEventListener('touchmove', handleMove, { passive: true })
      document.addEventListener('touchend', handleUp)
    },
    [onDragClientY, onDragStart, onDragEnd],
  )

  // -------------------------------------------------------------------------
  // 卸载清理:组件在拖拽中被卸载时恢复 body.user-select
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.userSelect = previousUserSelectRef.current ?? ''
        draggingRef.current = false
      }
    }
  }, [])

  // -------------------------------------------------------------------------
  // 键盘操作(↑/↓ ±1%, PageUp/PageDown ±5%, Home → min, End → max)
  // -------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const SMALL = 0.01
      const LARGE = 0.05
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          onRatioChangeBy(-SMALL)
          break
        case 'ArrowDown':
          e.preventDefault()
          onRatioChangeBy(SMALL)
          break
        case 'PageUp':
          e.preventDefault()
          onRatioChangeBy(-LARGE)
          break
        case 'PageDown':
          e.preventDefault()
          onRatioChangeBy(LARGE)
          break
        case 'Home':
          e.preventDefault()
          onRatioChangeBy(minRatio - ratio)
          break
        case 'End':
          e.preventDefault()
          onRatioChangeBy(maxRatio - ratio)
          break
      }
    },
    [onRatioChangeBy, ratio, minRatio, maxRatio],
  )

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  const ratioPct = Math.round(ratio * 100)

  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-valuenow={ratioPct}
      aria-valuemin={Math.round(minRatio * 100)}
      aria-valuemax={Math.round(maxRatio * 100)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className="group h-1.5 bg-transparent cursor-row-resize relative my-2 flex-shrink-0 select-none touch-none focus:outline-none focus-visible:bg-brand-50"
      title="拖拽调整上下比例"
    >
      {/* 中央握把条(24x2):hover / focus 时变 brand 色 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-0.5 bg-border-strong rounded-sm group-hover:bg-brand group-focus-visible:bg-brand transition-colors pointer-events-none" />
    </div>
  )
}