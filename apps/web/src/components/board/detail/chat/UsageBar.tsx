'use client'

/**
 * UsageBar — 顶部状态条(ADR-0029 D8 决策 39 · issue 08)
 *
 * 显示 model / tokens / cost / turns / duration + sub-agent sub-line;
 * 含 plan mode toggle + auto-allow toggle + model switch select
 * (切昂贵 model 弹 confirm modal 由父组件管)。
 *
 * 视觉对照 docs/design/pages/board-chat-subagent.html lines 42-52:
 * - model-pill:pill 容器 + brand 色圆点(昂贵 model 用 warning 色)+ label
 * - toggle switch:22×14 track + 10px knob,on 时 brand bg + knob 右移
 *
 * Props 全部受控 —— 由父组件(CardTranscriptPanel)决定真实 state。
 * auto-allow toggle = permissionMode === 'bypassPermissions'(ADR-0029 D4);
 * 与 plan mode 互斥(plan on 时 auto-allow disabled,后端二次校验)。
 */

import type { ChatSessionMeta } from '@ai-devspace/shared'

export interface UsageBarProps {
  meta: ChatSessionMeta
  /** plan mode toggle 是否 disabled(bypassPermissions 时禁用) */
  planToggleDisabled?: boolean
  /** auto-allow toggle 是否 disabled(plan mode on / lock 时禁用) */
  autoAllowDisabled?: boolean
  /** sub-agent tokens 累计(派生自 stream 解析) */
  subAgentTokens?: number
  /** sub-agent cost 累计(USD) */
  subAgentCost?: number
  /** 当前 user 列表 — 用于 turns 数(本期直接走 meta.queryCount) */
  turns?: number
  /** session 累计 duration(毫秒;由父组件从 createdAt / lastQueryAt 派生) */
  durationMs?: number
  /** plan mode toggle on/off 触发 */
  onPlanToggle: (enabled: boolean) => void
  /** auto-allow toggle on/off 触发(default ↔ bypassPermissions) */
  onAutoAllowChange: (enabled: boolean) => void
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
  autoAllowDisabled = false,
  subAgentTokens = 0,
  subAgentCost = 0,
  turns,
  durationMs = 0,
  onPlanToggle,
  onAutoAllowChange,
  onModelChange,
}: UsageBarProps) {
  const isPlan = meta.permissionMode === 'plan'
  const isAutoAllow = meta.permissionMode === 'bypassPermissions'
  const currentOpt = MODEL_OPTIONS.find((o) => o.value === meta.model)
  const isExpensive =
    !!currentOpt && 'expensive' in currentOpt && currentOpt.expensive === true

  return (
    <div
      data-testid="board-chat-usage-bar"
      data-model={meta.model}
      className="px-3 py-2 border border-border rounded-md bg-bg-elevated flex flex-col gap-1.5 text-xs"
    >
      {/* 主行:pill / tokens / cost / turns / duration + toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* model pill(对照设计 HTML .model-pill):brand 色圆点 + label + 原始 id */}
        <span
          data-testid="board-chat-model-pill"
          className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-md bg-bg-elevated text-text-1"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full inline-block ${
              isExpensive ? 'bg-warning' : 'bg-brand'
            }`}
          />
          <span className="font-medium">{currentOpt?.label ?? meta.model}</span>
          <span className="text-[10px] text-text-3 font-mono">{meta.model}</span>
        </span>
        {/* model switch select(保留可切换;pill 作只读当前态) */}
        <select
          data-testid="board-chat-model-select"
          value={meta.model}
          onChange={(e) => onModelChange(e.target.value)}
          aria-label="切换 model"
          className="border border-border bg-bg-elevated text-text-1 rounded px-1.5 py-0.5 text-xs"
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
              {'expensive' in opt && opt.expensive ? ' · 昂贵' : ''}
            </option>
          ))}
        </select>
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

        {/* toggles(对照设计 HTML .toggle switch) */}
        <div className="ml-auto flex items-center gap-3">
          {/* auto-allow toggle */}
          <button
            type="button"
            data-testid="board-chat-auto-allow-toggle"
            role="switch"
            aria-checked={isAutoAllow}
            aria-label="auto-allow"
            disabled={autoAllowDisabled}
            onClick={() => onAutoAllowChange(!isAutoAllow)}
            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs border ${
              isAutoAllow
                ? 'bg-brand-50 text-brand-700 border-brand'
                : 'bg-bg-elevated text-text-2 border-border'
            } ${autoAllowDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={
              autoAllowDisabled
                ? 'plan mode on 时 auto-allow 禁用'
                : '切换 auto-allow(读工具自动放行,写工具跳过 modal)'
            }
          >
            <span
              className={`relative w-[22px] h-[14px] rounded-full transition-colors ${
                isAutoAllow ? 'bg-brand' : 'bg-border-strong'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${
                  isAutoAllow ? 'left-[10px]' : ''
                }`}
              />
            </span>
            <span className="text-[10px]">auto-allow</span>
          </button>

          {/* plan mode toggle */}
          <button
            type="button"
            data-testid="board-chat-plan-toggle"
            role="switch"
            aria-checked={isPlan}
            disabled={planToggleDisabled}
            onClick={() => onPlanToggle(!isPlan)}
            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs border ${
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
      </div>
      {/* sub-line:cache + sub-agent tokens / cost */}
      <div className="flex items-center gap-2 text-[10px] text-text-3 font-mono">
        <span>cache {meta.cumulativeUsage.cumulativeCacheReadTokens}</span>
        <span>·</span>
        <span data-testid="board-chat-usage-sub-agent">
          含 sub-agent {subAgentTokens} tok / ${subAgentCost.toFixed(3)}
        </span>
      </div>
    </div>
  )
}
