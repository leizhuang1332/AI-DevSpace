'use client'

/**
 * UsageBar — 顶部状态条(ADR-0029 D8 决策 39)
 *
 * 显示 model / tokens / cost / turns / duration + sub-agent sub-line;
 * 含 plan mode toggle + model switch select(切昂贵 model 弹 confirm modal
 * 由父组件管)。
 *
 * Props 全部受控 —— 由父组件(CardTranscriptPanel)决定真实 state。
 */

import type { ChatSessionMeta } from '@ai-devspace/shared'

export interface UsageBarProps {
  meta: ChatSessionMeta
  /** plan mode toggle 是否 disabled(bypassPermissions 时禁用) */
  planToggleDisabled?: boolean
  /** sub-agent tokens 累计(派生自 stream 解析) */
  subAgentTokens?: number
  /** 当前 user 列表 — 用于 turns 数(本期直接走 meta.queryCount) */
  turns?: number
  /** session 累计 duration(毫秒;由父组件从 createdAt / lastQueryAt 派生) */
  durationMs?: number
  /** plan mode toggle on/off 触发 */
  onPlanToggle: (enabled: boolean) => void
  /** model 切换触发(由父组件决定要不要弹 confirm) */
  onModelChange: (model: string) => void
}

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-opus-5', label: 'Opus 5', expensive: true },
  { value: 'claude-haiku-5', label: 'Haiku 5' },
] as const

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm}m`
}

export function UsageBar({
  meta,
  planToggleDisabled = false,
  subAgentTokens = 0,
  turns,
  durationMs = 0,
  onPlanToggle,
  onModelChange,
}: UsageBarProps) {
  const isPlan = meta.permissionMode === 'plan'
  return (
    <div
      data-testid="board-chat-usage-bar"
      data-model={meta.model}
      className="px-3 py-2 border border-border rounded-md bg-bg-elevated flex flex-col gap-1.5 text-xs"
    >
      {/* 主行:model / tokens / cost / turns / duration */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          data-testid="board-chat-model-select"
          value={meta.model}
          onChange={(e) => onModelChange(e.target.value)}
          className="border border-border bg-bg-elevated text-text-1 rounded px-1.5 py-0.5 text-xs"
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-text-3 text-[10px] font-mono">{meta.model}</span>
        <span data-testid="board-chat-usage-cost" className="text-text-2 font-mono">
          ${meta.cumulativeUsage.cumulativeCostUsd.toFixed(2)}
        </span>
        <span data-testid="board-chat-usage-tokens" className="text-text-3 font-mono">
          {meta.cumulativeUsage.cumulativeInputTokens +
            meta.cumulativeUsage.cumulativeOutputTokens}{' '}
          tok
        </span>
        <span data-testid="board-chat-usage-turns" className="text-text-3 font-mono">
          {turns ?? meta.queryCount} turn
        </span>
        <span data-testid="board-chat-usage-duration" className="text-text-3 font-mono">
          {formatDuration(durationMs)}
        </span>
        <button
          type="button"
          data-testid="board-chat-plan-toggle"
          role="switch"
          aria-checked={isPlan}
          disabled={planToggleDisabled}
          onClick={() => onPlanToggle(!isPlan)}
          className={`ml-auto px-2 py-0.5 rounded text-xs border ${
            isPlan
              ? 'bg-brand text-white border-brand'
              : 'bg-bg-elevated text-text-2 border-border'
          } ${planToggleDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={
            planToggleDisabled ? 'auto-allow on 时 plan toggle 禁用' : '切换 plan mode'
          }
        >
          🛡️ Plan {isPlan ? '☑' : '☐'}
        </button>
      </div>
      {/* sub-line:cache + sub-agent tokens */}
      <div className="flex items-center gap-2 text-[10px] text-text-3 font-mono">
        <span>cache {meta.cumulativeUsage.cumulativeCacheReadTokens}</span>
        <span>·</span>
        <span>sub-agent {subAgentTokens} tok</span>
      </div>
    </div>
  )
}