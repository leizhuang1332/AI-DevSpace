/**
 * 「▶ 开始分析」按钮 — analyzing-fab ticket 07 复用
 *
 * 由 `AnalyzingZone` 主区与 `<AnalysisHistoryFabPanel>` N=0 空态 CTA 共同使用。
 * 任何位置点击都通过同一个 `handleStart` 入口启动 Analysis Run,state
 * 由父组件 useState 持有并下传 —— 保证两个渲染位置的「idle → starting →
 * running」状态机一致。
 *
 * - `state='idle'` → 显示「▶ 开始分析」可点击
 * - `state='starting' | 'running'` → 显示「分析中…」+ spinner + disabled 防重
 * - `disabled=true`(无可用 Skill)→ 显示「暂无」灰态,不可点击
 */

'use client'

export type StartAnalysisState = 'idle' | 'starting' | 'running'

export interface StartAnalysisButtonProps {
  state: StartAnalysisState
  /** 是否有可用 Skill —— 无 Skill 时按钮置不可点(沿用主区既有规则) */
  disabled?: boolean
  onClick?: () => void
}

export function StartAnalysisButton({
  state,
  disabled,
  onClick,
}: StartAnalysisButtonProps) {
  const isStreaming = state !== 'idle'
  const isDisabled = isStreaming || disabled
  return (
    <button
      type="button"
      data-testid="analysis-run-start-btn"
      data-state={state}
      data-disabled={disabled ? 'no_skills' : 'ok'}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold transition-colors flex-shrink-0 ${
        isDisabled
          ? 'bg-brand/50 text-white cursor-not-allowed'
          : 'bg-brand text-white hover:bg-brand-600'
      }`}
    >
      {isStreaming ? (
        <>
          <span
            aria-hidden
            data-testid="analysis-run-start-spinner"
            className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"
          />
          分析中…
        </>
      ) : (
        <>
          <span aria-hidden>▶</span>
          开始分析
        </>
      )}
    </button>
  )
}
