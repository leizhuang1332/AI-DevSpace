'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { extractPrdAnchors, type PrdAnchor } from '@ai-devspace/shared'

/**
 * PRD 顶部锚点条(issue 03)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 * 的 .anchor-bar 区域;内核交互:
 *
 *   1. 列出 PRD Markdown 的所有 H1 + H2 锚点(源顺序)
 *   2. 点击锚点 → 调用 onJumpTo(line);把光标/滚动条送到对应行
 *   3. 被点击的锚点高亮 ~1.5s(setTimeout 由外部 fake timer 驱动)
 *   4. Markdown 中无 H1/H2 → 不渲染(避免空态杂乱)
 *   5. 锚点是 `<button>`,Enter / Space 原生激活,无须手写键盘事件
 *
 * 设计要点:
 * - markdown 是纯函数输入 → useMemo 派生 anchors;编辑过程中随 source 实时刷新
 * - 暴露 highlightMs 注入位(默认 1500)→ 测试可缩短或延长,不影响生产行为
 * - timerRef + cleanup:组件卸载 / 切换锚点时及时 clearTimeout,避免泄漏 /
 *   旧 timer 把新锚点 highlight 提前清掉
 * - 锚点消失时(markdown 改到不含该行)高亮自动撤回,而不是等到 1.5s 后
 *
 * 不在 issue 03 范围(后续 ticket 引入):
 * - 锚点的"当前可视章节"高亮(随滚动联动)—— issue 04/05 引入 editor ref 后再做
 */

export const PRD_ANCHOR_HIGHLIGHT_MS = 1_500

export interface PrdAnchorBarProps {
  /** 当前 PRD Markdown 源文 —— 通过 extractPrdAnchors 派生锚点列表 */
  markdown: string
  /** 点击锚点时回调,把目标行号交给上层(父组件负责滚动 textarea / 移动光标) */
  onJumpTo: (line: number) => void
  /**
   * 高亮持续毫秒数;默认 1500(issue 03 验收 #6)。
   * 测试时可通过此 prop 缩短以保持测试可读;非测试场景不要覆盖。
   */
  highlightMs?: number
}

export function PrdAnchorBar({
  markdown,
  onJumpTo,
  highlightMs = PRD_ANCHOR_HIGHLIGHT_MS,
}: PrdAnchorBarProps): JSX.Element | null {
  // ---------------------------------------------------------------------------
  // 派生:当前 Markdown 的 H1 + H2 锚点列表
  // ---------------------------------------------------------------------------
  const anchors = useMemo(() => extractPrdAnchors(markdown), [markdown])

  // ---------------------------------------------------------------------------
  // 受控:当前高亮的锚点行号(null = 无高亮)
  // ---------------------------------------------------------------------------
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null)

  /** setTimeout id;非 null 时表示当前正处于 highlight 倒计时 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 卸载时清理 timer,避免对已卸载组件 setState */
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  /**
   * 当 source 变化导致当前高亮的锚点行号不再存在 → 立即撤回高亮。
   * 用单独 effect 跟 anchors 同步,避免 stale closure 错过边界。
   */
  useEffect(() => {
    if (
      highlightedLine !== null &&
      !anchors.some((a) => a.line === highlightedLine)
    ) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setHighlightedLine(null)
    }
    // 故意省略 highlightedLine —— 这是"快照撤回"逻辑,只在 anchors 变化时跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors])

  // ---------------------------------------------------------------------------
  // 点击 / 键盘激活 — 同一 handler
  // ---------------------------------------------------------------------------
  const handleActivate = useCallback(
    (anchor: PrdAnchor) => {
      // 1) 通知上层 jump(滚动 textarea / 设置 selectionStart 等)
      onJumpTo(anchor.line)

      // 2) 高亮当前锚点 —— 先清掉旧 timer,再排新 timer(setTimeout 时长由
      //    props 注入,默认 1500ms;测试可用 fake timers advance)
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
      setHighlightedLine(anchor.line)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setHighlightedLine(null)
      }, highlightMs)
    },
    [onJumpTo, highlightMs],
  )

  // ---------------------------------------------------------------------------
  // 空态:无 H1/H2 → 不渲染(issue 03 验收 #4)
  // ---------------------------------------------------------------------------
  if (anchors.length === 0) return null

  return (
    <div
      data-testid="prd-anchor-bar"
      data-anchor-count={anchors.length}
      role="toolbar"
      aria-label="PRD 大纲锚点"
      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-50 border border-brand-100 border-b-0 rounded-t-md text-xs text-brand-700 font-mono overflow-x-auto flex-shrink-0"
    >
      <span
        data-testid="prd-anchor-bar-label"
        className="text-brand-600 font-semibold flex-shrink-0"
      >
        大纲 ▾
      </span>
      {anchors.map((a) => {
        const isHighlighted = a.line === highlightedLine
        return (
          <button
            type="button"
            key={`${a.level}-${a.line}-${a.title}`}
            data-testid="anchor-item"
            data-anchor-line={a.line}
            data-anchor-level={a.level}
            data-anchor-title={a.title}
            data-highlighted={isHighlighted ? 'true' : 'false'}
            onClick={() => handleActivate(a)}
            aria-label={`跳到 ${a.level === 1 ? 'H1' : 'H2'}:${a.title}`}
            className={[
              'inline-flex items-center px-1.5 py-0.5 rounded',
              'text-text-2 hover:bg-bg-elevated hover:text-brand-700',
              'focus:outline-none focus:ring-2 focus:ring-brand-50',
              'transition-colors whitespace-nowrap',
              isHighlighted &&
                'bg-bg-elevated text-brand-700 font-semibold anchor-hl',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="opacity-60 mr-1">
              {a.level === 1 ? 'H1' : 'H2'}
            </span>
            {a.title}
          </button>
        )
      })}
      <span
        data-testid="prd-anchor-bar-count"
        className="ml-auto text-text-3 flex-shrink-0"
      >
        {anchors.length} 章节 · 点击跳转
      </span>
    </div>
  )
}
