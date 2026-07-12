import { describe, it, expect } from 'vitest'
import {
  AdmissionDimensionIdSchema,
  AdmissionDimensionId,
  AdmissionOverrideSchema,
  DEFAULT_ADMISSION_DIMENSIONS,
  ADMISSION_DIMENSION_META,
} from '../skill-schema.js'

// ============================================================================
// AdmissionDimensionIdSchema — 5 个默认 ID + 拒绝未知
// ============================================================================

describe('AdmissionDimensionIdSchema', () => {
  it('接受 5 个默认 ID', () => {
    const ids: AdmissionDimensionId[] = [
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ]
    for (const id of ids) {
      expect(AdmissionDimensionIdSchema.parse(id)).toBe(id)
    }
  })

  it('拒绝未知 ID', () => {
    expect(() => AdmissionDimensionIdSchema.parse('unknown_dim')).toThrow()
    expect(() => AdmissionDimensionIdSchema.parse('loss')).toThrow()
    expect(() => AdmissionDimensionIdSchema.parse('')).toThrow()
    expect(() => AdmissionDimensionIdSchema.parse(null)).toThrow()
    expect(() => AdmissionDimensionIdSchema.parse(123)).toThrow()
  })

  it('导出 DEFAULT_ADMISSION_DIMENSIONS 数组(5 维度,顺序固定)', () => {
    expect(DEFAULT_ADMISSION_DIMENSIONS).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ])
  })

  it('ADMISSION_DIMENSION_META 含 5 个维度的元数据(id/label/icon/severity)', () => {
    expect(Object.keys(ADMISSION_DIMENSION_META).sort()).toEqual(
      [
        'arch_conflict',
        'business_reasonable',
        'context_query',
        'loss_prevention',
        'performance',
      ].sort(),
    )

    for (const id of DEFAULT_ADMISSION_DIMENSIONS) {
      const meta = ADMISSION_DIMENSION_META[id]
      expect(meta.id).toBe(id)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.icon.length).toBeGreaterThan(0)
      expect(['red', 'orange', 'yellow', 'green', 'blue']).toContain(meta.severity)
    }
  })
})

// ============================================================================
// AdmissionOverrideSchema — Skill frontmatter 维度调整
// ============================================================================

describe('AdmissionOverrideSchema', () => {
  it('缺省时 = {}', () => {
    const r = AdmissionOverrideSchema.parse({})
    expect(r).toEqual({ add: [], skip: [] })
  })

  it('add: string[]', () => {
    const r = AdmissionOverrideSchema.parse({ add: ['coupon_consistency'] })
    expect(r.add).toEqual(['coupon_consistency'])
  })

  it('skip: string[]', () => {
    const r = AdmissionOverrideSchema.parse({ skip: ['business_reasonable'] })
    expect(r.skip).toEqual(['business_reasonable'])
  })

  it('add + skip 同时提供', () => {
    const r = AdmissionOverrideSchema.parse({
      add: ['coupon_consistency'],
      skip: ['business_reasonable'],
    })
    expect(r.add).toEqual(['coupon_consistency'])
    expect(r.skip).toEqual(['business_reasonable'])
  })

  it('add 元素必须都是 string', () => {
    expect(() =>
      AdmissionOverrideSchema.parse({ add: [1] as unknown as string[] }),
    ).toThrow()
  })

  it('skip 元素必须都是 string', () => {
    expect(() =>
      AdmissionOverrideSchema.parse({ skip: [true] as unknown as string[] }),
    ).toThrow()
  })

  it('add/skip 默认值都是空数组', () => {
    const r = AdmissionOverrideSchema.parse({})
    expect(r.add).toEqual([])
    expect(r.skip).toEqual([])
  })
})