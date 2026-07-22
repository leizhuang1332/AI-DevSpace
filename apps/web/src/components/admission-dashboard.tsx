/**
 * 准入仪表板组件(ADR-0013 D4 · issue 19a VS1)
 *
 * 顶部展示 PRD 准入校验状态:
 * - 左:N 张维度卡(默认 5 卡 · 顺序由 Skill frontmatter 装配决定)
 * - 右:总体结论徽章(pass / pending / fail)+ 待裁决 N 徽章 + [接受风险] 按钮
 *
 * 设计要点:
 * - 数据由 server 注入(admission 段),组件纯渲染 + 简单回调
 * - 维度卡点击 → onDimensionClick(预留 hook,后续 slice 填充内容)
 * - "接受风险" 按钮仅 verdict=fail 时显示,点击 → onAcceptRisk(将 verdict 改为 pending)
 *
 * 视觉参考:docs/design/pages/11h-A-zone-multisession-tabs.html 顶部"准入仪表板"段
 */

'use client'

import type {
  AdmissionData,
  AdmissionDimension,
  AdmissionVerdict,
} from '@/lib/analyzing'

export interface AdmissionDashboardProps {
  admission: AdmissionData
  /** verdict=fail 时显示的"接受风险"按钮回调 */
  onAcceptRisk: () => void
  /** 维度卡点击回调(预留 hook,后续 slice 填充具体行为) */
  onDimensionClick?: (dimensionId: string) => void
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
}: AdmissionDashboardProps) {
  return (
    <section
      data-testid="admission-dashboard"
      data-verdict={admission.verdict}
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

      {/* 右:徽章 + 按钮 */}
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
      </div>
    </section>
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