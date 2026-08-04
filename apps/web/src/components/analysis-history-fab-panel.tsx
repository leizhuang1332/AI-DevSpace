/**
 * 分析历史 FAB + 浮动面板(analyzing-fab ticket 01 · ADR-0022)
 *
 * 替代 issue 05 的右侧 320px 永久抽屉,改为"默认折叠的浮动召唤按钮
 * (FAB)+ 浮动面板"。本 ticket 仅落地最窄可演示骨架:
 *
 * - FAB 默认渲染(右上角),显示 `🗂️ 历史分析 N`
 * - N=0 时 N 数字呈灰色(text-3)
 * - 点 FAB → 打开/关闭浮动面板
 * - 面板头部固定显示「🗂️ 历史分析 N ✕」,头部右侧 ✕ 关闭
 * - N=0 面板内显示「暂无历史 Analysis Run」
 * - N>0 面板内复用 `HistoryRow` 列表(后续 ticket 02 补充删除 UX / N 计数规则 / a11y)
 * - 关闭方式:① 头部 ✕ 按钮 ② 点 FAB 以外任意位置 ③ 按 Esc
 * - ARIA:FAB `aria-expanded` 同步开合,`aria-label="历史分析 共 N 个 Run"`
 *   ;面板 `role="region"`(不是 dialog,不暗示模态)
 *
 * 不重写 `<AnalysisHistoryDrawer>` 本体 —— 该组件后续 ticket 02 才会真正
 * 接入"主视图列"。本组件只复用其 `HistoryRow`(已 export)。
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisRunMeta } from '@ai-devspace/shared'
import { HistoryRow } from './analysis-history-drawer'

export interface AnalysisHistoryFabPanelProps {
  /** Analysis Run 列表(SSR 注入 + SSE 追加 + 删除消失) */
  runs: ReadonlyArray<AnalysisRunMeta>
  /** 当前选中 Run id(用于高亮 + 删除时焦点规则) */
  activeRunId: string
  /** 点行 → 父组件切到该 Run(用户手动切换的判定由父组件维护) */
  onSelect: (runId: string) => void
  /** 点删除按钮 → 父组件弹二次确认;本组件不直接调 delete */
  onRequestDelete: (runId: string) => void
  /** Skill 名 → 简介;供行内显示 Skill 描述 */
  skillDescriptions?: ReadonlyMap<string, string>
}

/**
 * FAB + 浮动面板的根容器。
 *
 * 父组件(analyzing-zone 的 DesktopLayout / NarrowLayout)负责把本组件
 * 渲染到"主区右上角"的 `relative` 父节点下:FAB 与面板都用 `absolute`
 * 定位,FAB 锚定在右上,面板从 FAB 正下方弹出,覆盖在[识别产物]列之上
 * (不挤压列宽)。z-index 走 tailwind 命名 `z-fab` / `z-fab-panel`,
 * 不散落魔数(见 tailwind.config.ts `theme.extend.zIndex`)。
 */
export function AnalysisHistoryFabPanel({
  runs,
  activeRunId,
  onSelect,
  onRequestDelete,
  skillDescriptions,
}: AnalysisHistoryFabPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const fabRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const count = runs.length
  const isEmpty = count === 0

  // runs 永远按 created_at 倒序展示 —— 与原 AnalysisHistoryDrawer 行为一致
  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [runs],
  )

  // 点 Run 行 → 切 Run + 面板关闭(analyzing-fab ticket 02 · ADR-0022 决策 88~98)
  // 符合 Linear popover 心智「选中即走」;点删除按钮不动它(onRequestDelete
  // 由父组件接住)。
  const handleSelectAndClose = useCallback(
    (runId: string) => {
      onSelect(runId)
      setIsOpen(false)
    },
    [onSelect],
  )

  // 关闭方式二:点 FAB 面板以外的任意位置 → 关闭面板
  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null
      if (!target) return
      if (fabRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isOpen])

  // 关闭方式三:按 Esc → 关闭面板
  // - 监听挂 window 而非 document:与既有 `AnalysisDeleteRunDialog` 一致;
  //   keydown 事件从 focused element 冒泡至 document 再到 window,挂 window
  //   才能稳定接住(包括 click 后焦点不在面板内的情况)
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        data-testid="analysis-history-fab"
        data-run-count={count}
        data-empty={isEmpty ? 'true' : 'false'}
        data-active-run-id={activeRunId}
        aria-expanded={isOpen}
        aria-label={`历史分析 共 ${count} 个 Run`}
        aria-controls="analysis-history-panel"
        onClick={() => setIsOpen((v) => !v)}
        className="absolute right-3 top-3 z-fab inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg-elevated border border-border shadow-sm hover:bg-bg-subtle transition-colors text-xs"
      >
        <span aria-hidden>🗂️</span>
        <span className="font-semibold text-text-1">历史分析</span>
        <span
          data-testid="analysis-history-fab-count"
          className={`font-mono ${
            isEmpty ? 'text-text-3' : 'text-text-1'
          }`}
        >
          {count}
        </span>
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          id="analysis-history-panel"
          role="region"
          aria-label="历史分析列表"
          data-testid="analysis-history-panel"
          data-run-count={count}
          className="absolute right-3 top-14 z-fab-panel w-[320px] max-h-[480px] flex flex-col bg-bg-elevated border border-border-strong rounded-lg shadow-lg overflow-hidden"
        >
          <header className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between">
            <h2 className="text-md font-semibold flex items-center gap-2">
              <span aria-hidden>🗂️</span>
              <span>历史分析</span>
              <span
                data-testid="analysis-history-panel-count"
                className="text-[11px] font-mono text-text-3"
              >
                {count}
              </span>
            </h2>
            <button
              type="button"
              data-testid="analysis-history-panel-close"
              aria-label="关闭历史分析面板"
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-2 hover:text-text-1 hover:bg-bg-subtle transition-colors"
            >
              <span aria-hidden>✕</span>
            </button>
          </header>
          <div
            data-testid="analysis-history-panel-body"
            className="flex-1 min-h-0 overflow-auto"
          >
            {isEmpty ? (
              <div
                data-testid="analysis-history-panel-empty"
                className="px-4 py-6 text-center text-xs text-text-3"
              >
                暂无历史 Analysis Run
              </div>
            ) : (
              <ul
                data-testid="analysis-history-panel-list"
                className="flex flex-col"
              >
                {sortedRuns.map((run) => (
                  <HistoryRow
                    key={run.run_id}
                    run={run}
                    active={run.run_id === activeRunId}
                    skillDescription={skillDescriptions?.get(run.skill_name)}
                    onSelect={handleSelectAndClose}
                    onRequestDelete={onRequestDelete}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}
