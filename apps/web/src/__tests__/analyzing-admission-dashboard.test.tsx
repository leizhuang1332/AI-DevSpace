import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AdmissionDashboard } from '@/components/admission-dashboard'
import type { AdmissionData, AdmissionVerdict } from '@/lib/analyzing'
import { DEFAULT_ADMISSION_DIMENSIONS } from '@ai-devspace/shared'
import { ADMISSION_DIMENSION_META } from '@ai-devspace/shared'
import type { AdmissionDimensionId } from '@ai-devspace/shared'

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// 辅助:用默认 5 维度构造 AdmissionData
// ---------------------------------------------------------------------------

function buildAdmission(
  overrides: Partial<AdmissionData> = {},
  perDim: Record<string, number> = {},
): AdmissionData {
  // overrides.dimensions 是已构造的 AdmissionDimension[],否则从 DEFAULT_ADMISSION_DIMENSIONS 派生
  const dims =
    overrides.dimensions ??
    DEFAULT_ADMISSION_DIMENSIONS.map((id) => {
      const meta = ADMISSION_DIMENSION_META[id as AdmissionDimensionId]
      return {
        id,
        label: meta?.label ?? id,
        icon: meta?.icon ?? '🔵',
        severity: meta?.severity ?? 'blue',
        count: perDim[id] ?? 0,
      }
    })
  return {
    dimensions: dims,
    verdict: 'pending',
    pendingAdjudicationCount: 0,
    ...overrides,
  }
}

// ============================================================================
// 5 卡渲染(默认 5 维度)
// ============================================================================

describe('AdmissionDashboard · 默认 5 卡渲染', () => {
  it('渲染 5 张维度卡,顺序为 loss_prevention → context_query', () => {
    const admission = buildAdmission()
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)

    const cards = screen.getAllByTestId(/^admission-dim-/)
    expect(cards).toHaveLength(5)

    expect(screen.getByTestId('admission-dim-loss_prevention')).toBeInTheDocument()
    expect(screen.getByTestId('admission-dim-performance')).toBeInTheDocument()
    expect(screen.getByTestId('admission-dim-arch_conflict')).toBeInTheDocument()
    expect(screen.getByTestId('admission-dim-business_reasonable')).toBeInTheDocument()
    expect(screen.getByTestId('admission-dim-context_query')).toBeInTheDocument()
  })

  it('每张卡含 icon + 数字 + label', () => {
    const admission = buildAdmission({}, { loss_prevention: 2, performance: 3 })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)

    const lossCard = screen.getByTestId('admission-dim-loss_prevention')
    expect(lossCard.textContent).toContain('🔴')
    expect(lossCard.textContent).toContain('2')
    expect(lossCard.textContent).toContain('资损安全')

    const perfCard = screen.getByTestId('admission-dim-performance')
    expect(perfCard.textContent).toContain('🟠')
    expect(perfCard.textContent).toContain('3')
    expect(perfCard.textContent).toContain('性能')
  })
})

// ============================================================================
// Skill.add / Skill.skip
// ============================================================================

describe('AdmissionDashboard · Skill 装配(add / skip)', () => {
  it('Skill.add 新增 1 维度 → 渲染 6 卡', () => {
    const dims = [
      ...DEFAULT_ADMISSION_DIMENSIONS.map((id) => ({
        id,
        label: ADMISSION_DIMENSION_META[id].label,
        icon: ADMISSION_DIMENSION_META[id].icon,
        severity: ADMISSION_DIMENSION_META[id].severity,
        count: 0,
      })),
      { id: 'coupon_consistency', label: 'coupon_consistency', icon: '🔵', severity: 'blue' as const, count: 1 },
    ]
    render(
      <AdmissionDashboard
        admission={{ dimensions: dims, verdict: 'pending', pendingAdjudicationCount: 0 }}
        onAcceptRisk={vi.fn()}
      />,
    )

    const cards = screen.getAllByTestId(/^admission-dim-/)
    expect(cards).toHaveLength(6)
    expect(screen.getByTestId('admission-dim-coupon_consistency')).toBeInTheDocument()
  })

  it('Skill.skip 跳过 1 维度 → 渲染 4 卡', () => {
    const dims = DEFAULT_ADMISSION_DIMENSIONS.filter((d) => d !== 'business_reasonable').map(
      (id) => ({
        id,
        label: ADMISSION_DIMENSION_META[id].label,
        icon: ADMISSION_DIMENSION_META[id].icon,
        severity: ADMISSION_DIMENSION_META[id].severity,
        count: 0,
      }),
    )
    render(
      <AdmissionDashboard
        admission={{ dimensions: dims, verdict: 'pending', pendingAdjudicationCount: 0 }}
        onAcceptRisk={vi.fn()}
      />,
    )

    const cards = screen.getAllByTestId(/^admission-dim-/)
    expect(cards).toHaveLength(4)
    expect(screen.queryByTestId('admission-dim-business_reasonable')).toBeNull()
  })
})

// ============================================================================
// verdict 三态徽章
// ============================================================================

describe('AdmissionDashboard · verdict 徽章', () => {
  it.each<[AdmissionVerdict, string]>([
    ['pass', '✅ 准入通过'],
    ['pending', '⚠️ 待裁决'],
    ['fail', '❌ 准入失败'],
  ])('verdict=%s → 徽章文案 %s', (verdict, expected) => {
    const admission = buildAdmission({ verdict })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)
    const badge = screen.getByTestId('admission-verdict-badge')
    expect(badge.getAttribute('data-verdict')).toBe(verdict)
    expect(badge.textContent).toContain(expected)
  })
})

// ============================================================================
// "接受风险" 按钮(verdict=fail → 显示;其他 → 隐藏)
// ============================================================================

describe('AdmissionDashboard · 接受风险按钮', () => {
  it('verdict=fail → 显示 [接受风险] 按钮', () => {
    const onAccept = vi.fn()
    const admission = buildAdmission({ verdict: 'fail' })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={onAccept} />)
    const btn = screen.getByTestId('admission-accept-risk-btn')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onAccept).toHaveBeenCalledOnce()
  })

  it('verdict=pending → 隐藏 [接受风险] 按钮', () => {
    const admission = buildAdmission({ verdict: 'pending' })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)
    expect(screen.queryByTestId('admission-accept-risk-btn')).toBeNull()
  })

  it('verdict=pass → 隐藏 [接受风险] 按钮', () => {
    const admission = buildAdmission({ verdict: 'pass' })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)
    expect(screen.queryByTestId('admission-accept-risk-btn')).toBeNull()
  })
})

// ============================================================================
// 待裁决 N 徽章
// ============================================================================

describe('AdmissionDashboard · 待裁决 N 徽章', () => {
  it('pendingAdjudicationCount > 0 → 显示 "待裁决 N" 徽章', () => {
    const admission = buildAdmission({ pendingAdjudicationCount: 10 })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)
    const badge = screen.getByTestId('admission-pending-badge')
    expect(badge.textContent).toContain('待裁决')
    expect(badge.textContent).toContain('10')
  })

  it('pendingAdjudicationCount = 0 → 不显示徽章', () => {
    const admission = buildAdmission({ pendingAdjudicationCount: 0 })
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)
    expect(screen.queryByTestId('admission-pending-badge')).toBeNull()
  })
})

// ============================================================================
// 维度卡点击交互(预留 hook)
// ============================================================================

describe('AdmissionDashboard · 维度卡点击(预留 hook)', () => {
  it('点击维度卡 → 触发 onDimensionClick(dimId)', () => {
    const onDimClick = vi.fn()
    const admission = buildAdmission()
    render(
      <AdmissionDashboard
        admission={admission}
        onAcceptRisk={vi.fn()}
        onDimensionClick={onDimClick}
      />,
    )

    fireEvent.click(screen.getByTestId('admission-dim-loss_prevention'))
    expect(onDimClick).toHaveBeenCalledWith('loss_prevention')
  })

  it('未传 onDimensionClick 时点击不崩', () => {
    const admission = buildAdmission()
    render(<AdmissionDashboard admission={admission} onAcceptRisk={vi.fn()} />)
    expect(() =>
      fireEvent.click(screen.getByTestId('admission-dim-performance')),
    ).not.toThrow()
  })
})