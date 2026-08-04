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
 * - N=0 面板内显示「暂无历史 Analysis Run · 点击下方 [▶ 开始分析] 按钮发起首次分析」
 * - N>0 面板内复用 `HistoryRow` 列表(后续 ticket 02 补充删除 UX / N 计数规则 / a11y)
 * - 关闭方式:① 头部 ✕ 按钮 ② 点 FAB 以外任意位置 ③ 按 Esc
 * - ARIA:FAB `aria-expanded` 同步开合,`aria-label="历史分析 共 N 个 Run"`
 *   ;面板 `role="region"`(不是 dialog,不暗示模态)
 *
 * ticket 03:增加可选 prop `suppressOutsideClose`(删除流程期间禁止外点关
 * 闭)。父组件在 `<AnalysisDeleteRunDialog>` 显示阶段置 true,确保用户在
 * 二次确认对话期间的 click 不会误关面板。`<AnalysisHistoryDrawer>` 本体
 * 仍保留复用,不重写 HistoryRow 渲染逻辑。
 *
 * ticket 06 · ADR-0022 D6 a11y 全套:
 * - FAB 增加 `aria-haspopup="region"` 指向面板的 role
 * - 头部 ✕ 按钮 `aria-label="关闭历史分析列表"`(中文文案)
 * - 面板保持 non-modal `role="region"`(不暗示模态,不困焦点),沿用浏览器
 *   原生 Tab 顺序(不引入 focus-trap 库)
 *
 * ticket 07:N 计数规则(0 灰 / 99+ 上限)+ N=0 空态 CTA:
 * - N=99 显示 `99`,N≥100 显示 `99+`(Gmail 范式,不撑爆 FAB 宽度);
 *   `data-run-count` 仍保留真实数字便于自动化断言
 * - FAB 不显示运行中 dot(运行中信号走底部 AI 思考条 4 指示器)
 * - N=0 空态加上 CTA「▶ 开始分析」按钮,沿用主区 `StartAnalysisButton`,
 *   点击触发父组件的 `handleStart`(同一入口,行为完全等价)
 *
 * 不重写 `<AnalysisHistoryDrawer>` 本体 —— 该组件后续 ticket 02 才会真正
 * 接入"主视图列"。本组件只复用其 `HistoryRow`(已 export)。
 */

'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { AnalysisRunMeta } from '@ai-devspace/shared'
import { HistoryRow } from './analysis-history-drawer'
import {
  StartAnalysisButton,
  type StartAnalysisState,
} from './start-analysis-button'

/** 面板 N 上限 —— Gmail 范式,N≥100 一律显示 `99+`。 */
const FAB_COUNT_CEILING = 100

/** 把真实计数格式化为 FAB 显示文案(N=0 / N=99 / N≥100 → `99+`)。 */
function formatFabCount(n: number): string {
  if (n >= FAB_COUNT_CEILING) return '99+'
  return String(n)
}

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
  /**
   * 抑制「点 FAB / 面板以外任意位置」关闭行为(analyzing-fab ticket 03 ·
   * ADR-0022 D5.1)。当父组件的二次确认对话框显示期间,父组件把此 prop 置
   * true,避免用户在对话框上 click 触发 panel 关闭(useEffect mousedown
   * listener 默认会关掉 panel;此 prop 让该 listener 跳过)。Esc 与 ✕ 按钮
   * 仍可显式关闭。
   */
  suppressOutsideClose?: boolean
  /**
   * 面板是否打开(controlled prop · analyzing-fab ticket 04 · ADR-0022
   * D5.2)。父组件 `AnalyzingZone` 持有此 state,以便通过
   * `AnalyzingHistoryFabController` 暴露给 Cmd+K 等上层消费方。
   */
  isOpen: boolean
  /** 设置面板开合 —— 父组件持有此 setState。Cmd+K 通过 controller 间接调。 */
  onOpenChange: (open: boolean) => void
  /**
   * 「开始分析」按钮状态机(analyzing-fab ticket 07)。
   * N=0 空态 CTA 沿用此状态机:`idle → starting → running` 显示完全交
   * 由父组件 useState 持有,本组件不复制一份。
   */
  startAnalysisState?: StartAnalysisState
  /**
   * 「开始分析」按钮 disabled 标志(analyzing-fab ticket 07)。
   * 通常与 `availableSkills.length === 0` 一致 —— 父组件把可用 Skill
   * 数推到此处,N=0 空态 CTA 与主区按钮的 disabled 行为完全对齐。
   */
  startAnalysisDisabled?: boolean
  /**
   * 「开始分析」点击回调(analyzing-fab ticket 07)。
   * 空态 CTA 点击走父组件 `handleStart` 入口,与主区按钮同入口。
   */
  onStartAnalysis?: () => void | Promise<void>
}

/**
 * FAB + 浮动面板的根容器。
 *
 * 父组件(analyzing-zone 的 DesktopLayout / NarrowLayout)负责把本组件
 * 渲染到"主区右上角"的 `relative` 父节点下:FAB 与面板都用 `absolute`
 * 定位,FAB 锚定在右上,面板从 FAB 正下方弹出,覆盖在[识别产物]列之上
 * (不挤压列宽)。z-index 走 tailwind 命名 `z-fab` / `z-panel`,
 * 不散落魔数(见 tailwind.config.ts `theme.extend.zIndex`)。
 *
 * analyzing-fab ticket 08 · ADR-0022 D8:
 * - 面板宽度 = `min(320px, calc(100vw - 24px))`,窄视口(< 1024px)下自
 *   然收敛到视口宽度 - 24px,不溢出视口右边;桌面形态下 320px 是
 *   min(320px, calc(100vw-24px)) 的更小值,等效保留桌面 320px。
 * - FAB / 面板的 z-fab / z-panel 由 tailwind 集中声明(同时新增
 *   z-overlay / z-modal 命名槽位,留给后续 overlay / 模态使用)。
 */
export function AnalysisHistoryFabPanel({
  runs,
  activeRunId,
  onSelect,
  onRequestDelete,
  skillDescriptions,
  suppressOutsideClose,
  isOpen,
  onOpenChange,
  startAnalysisState = 'idle',
  startAnalysisDisabled = false,
  onStartAnalysis,
}: AnalysisHistoryFabPanelProps) {
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
      onOpenChange(false)
    },
    [onSelect, onOpenChange],
  )

  // 关闭方式二:点 FAB 面板以外的任意位置 → 关闭面板
  // ticket 03:当父组件的二次确认对话框显示时,父组件置 suppressOutsideClose
  // 为 true 跳过此 listener,避免用户在 dialog 上的 click 误关 panel。
  useEffect(() => {
    if (!isOpen) return
    if (suppressOutsideClose) return
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null
      if (!target) return
      if (fabRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      onOpenChange(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isOpen, suppressOutsideClose, onOpenChange])

  // 关闭方式三:按 Esc → 关闭面板
  // - 监听挂 window 而非 document:与既有 `AnalysisDeleteRunDialog` 一致;
  //   keydown 事件从 focused element 冒泡至 document 再到 window,挂 window
  //   才能稳定接住(包括 click 后焦点不在面板内的情况)
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onOpenChange])

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
        // `aria-haspopup` 标准值并不含 `region`(W3C ARIA 1.1 仅列出
        // menu/listbox/tree/grid/dialog)。ticket 06 选 `region` 是为了
        // 显式指明召唤的是 `role="region"` 的面板(屏幕阅读器在播报"展开
        // 弹出元素"时朗读的角色提示)。React 的 HTMLButton 类型较保守,
        // 这里用一个独立的对象 cast 注入,绕过严格检查。
        aria-haspopup={'region' as 'menu'}
        onClick={() => onOpenChange(!isOpen)}
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
          {formatFabCount(count)}
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
          className="absolute right-3 top-14 z-panel w-[min(320px,calc(100vw-24px))] max-h-[480px] flex flex-col bg-bg-elevated border border-border-strong rounded-lg shadow-lg overflow-hidden"
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
              aria-label="关闭历史分析列表"
              onClick={() => onOpenChange(false)}
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
                className="px-4 py-6 flex flex-col items-center gap-3 text-center text-xs text-text-3"
              >
                {/* ticket 07:升级空态文案,引导用户去点 CTA */}
                <span>
                  暂无历史 Analysis Run · 点击下方 [▶ 开始分析] 按钮发起首次分析
                </span>
                {/* ticket 07:空态 CTA 沿用主区 StartAnalysisButton,等
                    价于主区 [▶ 开始分析] 按钮 —— 同一 handleStart 入口,
                    同一 idle → starting → running 状态机。data-testid
                    复用,以便 e2e / 自动化统一入口。 */}
                {onStartAnalysis && (
                  <StartAnalysisButton
                    state={startAnalysisState}
                    disabled={startAnalysisDisabled}
                    onClick={onStartAnalysis}
                  />
                )}
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
