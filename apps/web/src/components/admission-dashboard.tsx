/**
 * 准入仪表板组件(ADR-0013 D4 · issue 19a VS1)
 *
 * 顶部展示 PRD 准入校验状态:
 * - 左:N 张维度卡(默认 5 卡 · 顺序由 Skill frontmatter 装配决定)
 * - 右:总体结论徽章(pass / pending / fail)+ 待裁决 N 徽章 + [接受风险] 按钮 +
 *      ticket 05 「开始分析」主按钮(仅空态可见)
 *
 * 设计要点:
 * - 数据由 server 注入(admission 段),组件纯渲染 + 简单回调
 * - 维度卡点击 → onDimensionClick(预留 hook,后续 slice 填充内容)
 * - "接受风险" 按钮仅 verdict=fail 时显示,点击 → onAcceptRisk(将 verdict 改为 pending)
 * - ticket 05 (ADR-0020 D9):「开始分析」按钮仅当父组件判定空态时渲染
 *   (条件:`sessions.length === 0 && admission.dimensions.every(d => d.count === 0)` —
 *   sessions 来自 analyzing-zone,dimensions 通过 admission 字段传入,
 *   由父组件组合后通过 `showStartButton` 传入);点击 → onStart → POST start
 *   → SSE 推 chunks → count 自然变化 → 条件变 false 按钮自然消失
 *
 * ticket 05 (ADR-0020 D9):空态时根节点附加 `data-phase="empty_armed"` 数据属性,
 * 供 CSS / 后续 E2E 区分空态与有产物态(视觉差异暂不强制,留 hook)。
 *
 * 视觉参考:docs/design/pages/11h-A-zone-multisession-tabs.html 顶部"准入仪表板"段
 */

'use client'

import type {
  AdmissionData,
  AdmissionDimension,
  AdmissionVerdict,
} from '@/lib/analyzing'

/** ticket 05 (ADR-0020 D9):「开始分析」按钮流式状态。决定文案 + 禁用 + spinner。 */
export type AdmissionStartState = 'idle' | 'starting' | 'running'

export interface AdmissionDashboardProps {
  admission: AdmissionData
  /** verdict=fail 时显示的"接受风险"按钮回调 */
  onAcceptRisk: () => void
  /** 维度卡点击回调(预留 hook,后续 slice 填充具体行为) */
  onDimensionClick?: (dimensionId: string) => void
  /** ticket 05:渲染「开始分析」按钮(渲染条件由父组件计算) */
  showStartButton?: boolean
  /** ticket 05:「开始分析」按钮点击回调 */
  onStart?: () => void
  /** ticket 05:「开始分析」按钮流式状态(默认 'idle') */
  startState?: AdmissionStartState
}

// ---------------------------------------------------------------------------
// 视觉常量(severity → { border-l 类, count 数字颜色 },合并以避免 Data Clump)
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<
  AdmissionDimension['severity'],
  { border: string; countText: string }
> = {
  red: { border: 'border-l-error', countText: 'text-error' },
  orange: { border: 'border-l-warning', countText: 'text-warning' },
  yellow: { border: 'border-l-yellow-500', countText: 'text-yellow-600' },
  green: { border: 'border-l-success', countText: 'text-success' },
  blue: { border: 'border-l-blue-500', countText: 'text-blue-600' },
}

const VERDICT_TEXT: Record<AdmissionVerdict, { label: string; class: string }> = {
  pass: { label: '✅ 准入通过', class: 'bg-success/10 text-success border-success' },
  pending: { label: '⚠️ 待裁决', class: 'bg-warning/10 text-warning border-warning' },
  fail: { label: '❌ 准入失败', class: 'bg-error/10 text-error border-error' },
}

export function AdmissionDashboard({
  admission,
  onAcceptRisk,
  onDimensionClick,
  showStartButton,
  onStart,
  startState = 'idle',
}: AdmissionDashboardProps) {
  return (
    <section
      data-testid="admission-dashboard"
      data-verdict={admission.verdict}
      data-phase={showStartButton ? 'empty_armed' : 'active'}
      className="bg-bg-elevated border border-border rounded-lg px-4 py-1.5 flex items-center gap-2"
    >
      {/* 左:N 张维度卡 */}
      <div
        data-testid="admission-dimensions"
        className="flex-1 flex items-center gap-1 overflow-x-auto"
      >
        {admission.dimensions.map((dim) => (
          <DimensionCard
            key={dim.id}
            dim={dim}
            onClick={onDimensionClick ? () => onDimensionClick(dim.id) : undefined}
          />
        ))}
      </div>

      {/* 右:徽章 + 按钮(ticket 05 · ADR-0020 D9:「开始分析」条件渲染) */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {admission.pendingAdjudicationCount > 0 && (
          <span
            data-testid="admission-pending-badge"
            data-count={admission.pendingAdjudicationCount}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-warning/10 text-warning border border-warning"
          >
            待裁决 {admission.pendingAdjudicationCount}
          </span>
        )}
        <span
          data-testid="admission-verdict-badge"
          data-verdict={admission.verdict}
          className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
            VERDICT_TEXT[admission.verdict].class
          }`}
        >
          {VERDICT_TEXT[admission.verdict].label}
        </span>
        {admission.verdict === 'fail' && (
          <button
            type="button"
            data-testid="admission-accept-risk-btn"
            onClick={onAcceptRisk}
            className="inline-flex items-center h-6 px-2 rounded-md text-[11px] font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
          >
            接受风险
          </button>
        )}
        {showStartButton && (
          <StartAnalysisButton state={startState} onClick={onStart} />
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// StartAnalysisButton(ticket 05 · ADR-0020 D9)
// ---------------------------------------------------------------------------

/**
 * 「开始分析」按钮 — 仅 AdmissionDashboard 空态可见。
 *
 * 视觉:与 verdict 徽章平行(h-6,text-[11px]),brand 主色填充;不抢眼、
 * 不破坏 ADR-0019 主区锁高度 + 列内独立滚动契约。
 *
 * 状态机:
 *   idle      → 「▶ 开始分析」,可点击
 *   starting  → 「分析中…」(等待 POST 返回);disabled 防重
 *   running   → 「分析中…」(POST 已返回,SSE 推 chunks);disabled 防重
 *
 * 设计注意:starting 与 running 共用同一份"分析中…"文案,二态在视觉上等价
 * 即可(用户不需要区分"等待 POST"与"等 SDK");`data-state` 属性保留以供测试
 * 区分两态。
 *
 * `onClick` 可省略:流式态(`state !== 'idle'`)时按钮 disabled,故未传
 * onClick 也不会触发"不存在的回调"。
 */
function StartAnalysisButton({
  state,
  onClick,
}: {
  state: AdmissionStartState
  onClick?: () => void
}) {
  const isStreaming = state !== 'idle'
  return (
    <button
      type="button"
      data-testid="admission-start-btn"
      data-state={state}
      onClick={isStreaming ? undefined : onClick}
      disabled={isStreaming}
      aria-disabled={isStreaming}
      className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
        isStreaming
          ? 'bg-brand/70 text-white cursor-wait'
          : 'bg-brand text-white hover:bg-brand-600'
      }`}
    >
      {isStreaming ? (
        <>
          <span
            aria-hidden
            data-testid="admission-start-spinner"
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

// ---------------------------------------------------------------------------
// DimensionCard
// ---------------------------------------------------------------------------

function DimensionCard({
  dim,
  onClick,
}: {
  dim: AdmissionDimension
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`admission-dim-${dim.id}`}
      data-dim-id={dim.id}
      data-severity={dim.severity}
      data-count={dim.count}
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-[64px] px-2 py-1 bg-bg-subtle border border-border rounded-md border-l-[3px] ${SEVERITY_STYLES[dim.severity].border} hover:bg-brand-50/40 transition-colors text-left`}
    >
      <span className="text-base leading-none" aria-hidden>
        {dim.icon}
      </span>
      <span
        className={`text-sm font-semibold font-mono mt-0.5 ${SEVERITY_STYLES[dim.severity].countText}`}
      >
        {dim.count}
      </span>
      <span className="text-[10px] text-text-3 mt-0 whitespace-nowrap">{dim.label}</span>
    </button>
  )
}