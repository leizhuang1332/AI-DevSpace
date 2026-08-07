import { describe, it, expect } from 'vitest'
import {
  SECTION_META,
  REQUIREMENT_SECTIONS,
  SECTION_LIFECYCLE_ORDER,
  DEFAULT_ZONE_ID,
  SECTION_STATUS_COLOR_CLASS,
  SECTION_STATUS_COLOR_LABEL,
  getSectionByRouteSegment,
  getZoneByRouteSegment,
  resolveDefaultZoneRouteSegment,
} from '../sections.js'

// ============================================================================
// SECTION_META(ADR-0026 D2:4 section hardcode)
// ============================================================================

describe('SECTION_META', () => {
  it('导出 4 个 section 元数据', () => {
    expect(REQUIREMENT_SECTIONS).toEqual([
      'drafting',
      'analyzing',
      'board',
      'wrapup',
    ])
    expect(SECTION_LIFECYCLE_ORDER).toEqual(REQUIREMENT_SECTIONS)
  })

  it('每个 section 含必要 UI 字段(camelCase)', () => {
    for (const id of REQUIREMENT_SECTIONS) {
      const z = SECTION_META[id]
      expect(z.id).toBe(id)
      expect(typeof z.label).toBe('string')
      expect(z.label.length).toBeGreaterThan(0)
      expect(typeof z.displayName).toBe('string')
      expect(z.displayName.length).toBeGreaterThan(0)
      expect(typeof z.icon).toBe('string')
      expect(z.icon.length).toBeGreaterThan(0)
      expect(typeof z.routeSegment).toBe('string')
      expect(z.routeSegment.length).toBeGreaterThan(0)
      expect(typeof z.hasResourceTree).toBe('boolean')
      expect(typeof z.hasInlineRail).toBe('boolean')
      expect([
        'gray',
        'blue',
        'purple',
        'yellow',
        'green',
        'red',
        'purple-warn',
      ]).toContain(z.statusColor)
      expect(typeof z.statusPulse).toBe('boolean')
      expect(typeof z.description).toBe('string')
      expect(Array.isArray(z.defaultArming)).toBe(true)
    }
  })

  it('routeSegment 唯一', () => {
    const segs = REQUIREMENT_SECTIONS.map((id) => SECTION_META[id].routeSegment)
    expect(new Set(segs).size).toBe(segs.length)
  })

  it('4 section 的 resourceTree / inlineRail 组合符合 ADR-0026 D2', () => {
    const tree = Object.fromEntries(
      REQUIREMENT_SECTIONS.map((id) => [id, SECTION_META[id].hasResourceTree]),
    ) as Record<string, boolean>
    const rail = Object.fromEntries(
      REQUIREMENT_SECTIONS.map((id) => [id, SECTION_META[id].hasInlineRail]),
    ) as Record<string, boolean>
    // DRAFTING:仅 Inline 栏(issue 01 后无资源树)
    expect(tree.drafting).toBe(false)
    expect(rail.drafting).toBe(true)
    // BOARD:全宽无树无栏(ADR-0027 D2)
    expect(tree.board).toBe(false)
    expect(rail.board).toBe(false)
    // ANALYZING:全宽无树无栏
    expect(tree.analyzing).toBe(false)
    expect(rail.analyzing).toBe(false)
    // WRAP-UP:仅资源树
    expect(tree.wrapup).toBe(true)
    expect(rail.wrapup).toBe(false)
  })

  it('statusPulse 仅 ANALYZING 为 true(ADR §6 决策 49)', () => {
    const pulse = Object.fromEntries(
      REQUIREMENT_SECTIONS.map((id) => [id, SECTION_META[id].statusPulse]),
    ) as Record<string, boolean>
    expect(pulse.analyzing).toBe(true)
    expect(pulse.drafting).toBe(false)
    expect(pulse.board).toBe(false)
    expect(pulse.wrapup).toBe(false)
  })

  it('statusColor:board=blue, analyzing=purple-warn, wrapup=gray, drafting=gray', () => {
    expect(SECTION_META.drafting.statusColor).toBe('gray')
    expect(SECTION_META.board.statusColor).toBe('blue')
    expect(SECTION_META.analyzing.statusColor).toBe('purple-warn')
    expect(SECTION_META.wrapup.statusColor).toBe('gray')
  })
})

// ============================================================================
// SECTION_STATUS_COLOR_CLASS / SECTION_STATUS_COLOR_LABEL
// ============================================================================

describe('SECTION_STATUS_COLOR_CLASS / SECTION_STATUS_COLOR_LABEL', () => {
  it('SECTION_STATUS_COLOR_CLASS 覆盖全部 7 种状态色(兼容保留)', () => {
    expect(Object.keys(SECTION_STATUS_COLOR_CLASS).sort()).toEqual([
      'blue',
      'gray',
      'green',
      'purple',
      'purple-warn',
      'red',
      'yellow',
    ])
  })

  it('purple-warn 含 ring 类(ANALYZING 特殊标记,原 CLARIFYING 迁移)', () => {
    expect(SECTION_STATUS_COLOR_CLASS['purple-warn']).toContain('ring-')
    expect(SECTION_STATUS_COLOR_CLASS['purple-warn']).toContain('red-')
  })

  it('SECTION_STATUS_COLOR_LABEL 7 种均有中文标签', () => {
    expect(Object.keys(SECTION_STATUS_COLOR_LABEL)).toHaveLength(7)
    for (const label of Object.values(SECTION_STATUS_COLOR_LABEL)) {
      expect(label).toBeTypeOf('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// REQUIREMENT_SECTIONS / DEFAULT_ZONE_ID
// ============================================================================

describe('REQUIREMENT_SECTIONS', () => {
  it('顺序为 drafting → analyzing → board → wrapup', () => {
    expect(REQUIREMENT_SECTIONS).toEqual([
      'drafting',
      'analyzing',
      'board',
      'wrapup',
    ])
  })

  it('与 SECTION_META 的 id 集合一致', () => {
    expect(new Set(REQUIREMENT_SECTIONS)).toEqual(
      new Set(
        Object.keys(SECTION_META) as Array<
          (typeof REQUIREMENT_SECTIONS)[number]
        >,
      ),
    )
  })
})

describe('DEFAULT_ZONE_ID', () => {
  it('默认 drafting', () => {
    expect(DEFAULT_ZONE_ID).toBe('drafting')
  })
})

// ============================================================================
// getSectionByRouteSegment(含向后兼容别名 getZoneByRouteSegment)
// ============================================================================

describe('getSectionByRouteSegment', () => {
  it('合法 routeSegment 返回对应 section', () => {
    expect(getSectionByRouteSegment('drafting')?.id).toBe('drafting')
    expect(getSectionByRouteSegment('board')?.id).toBe('board')
    expect(getSectionByRouteSegment('analyzing')?.id).toBe('analyzing')
    expect(getSectionByRouteSegment('wrap-up')?.id).toBe('wrapup')
  })

  it('退役 routeSegment 返回 null(clarifying / designing / executing 不再合法)', () => {
    expect(getSectionByRouteSegment('clarifying')).toBeNull()
    expect(getSectionByRouteSegment('designing')).toBeNull()
    expect(getSectionByRouteSegment('executing')).toBeNull()
  })

  it('未知 routeSegment 返回 null', () => {
    expect(getSectionByRouteSegment('unknown-section')).toBeNull()
    expect(getSectionByRouteSegment('')).toBeNull()
    expect(getSectionByRouteSegment('DRAFTING')).toBeNull() // case-sensitive
  })

  it('routeSegment 与 id 解耦:wrap-up route 对应 wrapup id', () => {
    // ADR §9 有意识设计:id 是程序内部名,routeSegment 是 URL 片段
    const z = getSectionByRouteSegment('wrap-up')
    expect(z?.id).toBe('wrapup')
    expect(z?.routeSegment).toBe('wrap-up')
  })

  it('getZoneByRouteSegment 是向后兼容别名(同 getSectionByRouteSegment)', () => {
    expect(getZoneByRouteSegment('board')?.id).toBe('board')
    expect(getZoneByRouteSegment('wrap-up')?.id).toBe('wrapup')
    expect(getZoneByRouteSegment('clarifying')).toBeNull()
  })
})

// ============================================================================
// resolveDefaultZoneRouteSegment(cookie last_zone 契约不变)
// ============================================================================

describe('resolveDefaultZoneRouteSegment', () => {
  it('cookie 缺失 → 默认 drafting route', () => {
    expect(resolveDefaultZoneRouteSegment(undefined)).toBe('drafting')
  })

  it('cookie 为合法 routeSegment → 使用 cookie 值', () => {
    expect(resolveDefaultZoneRouteSegment('board')).toBe('board')
    expect(resolveDefaultZoneRouteSegment('analyzing')).toBe('analyzing')
    expect(resolveDefaultZoneRouteSegment('wrap-up')).toBe('wrap-up')
  })

  it('cookie 为退役 routeSegment → fallback 默认 drafting(老 cookie 失效)', () => {
    // ADR-0027:clarifying / designing / executing 退役,老 cookie 不再识别
    expect(resolveDefaultZoneRouteSegment('clarifying')).toBe('drafting')
    expect(resolveDefaultZoneRouteSegment('designing')).toBe('drafting')
    expect(resolveDefaultZoneRouteSegment('executing')).toBe('drafting')
  })

  it('cookie 为未知值 → fallback 默认 drafting', () => {
    expect(resolveDefaultZoneRouteSegment('garbage')).toBe('drafting')
    expect(resolveDefaultZoneRouteSegment('DRAFTING')).toBe('drafting')
  })

  it('永不基于 id 推断(决策 15 反对状态机:cookie 若写 id 而非 routeSegment 也不会被误识别)', () => {
    // cookie 写 id 而非 routeSegment 不应误用(wrapup 是 id 不是 routeSegment)
    expect(resolveDefaultZoneRouteSegment('wrapup')).toBe('drafting')
    expect(resolveDefaultZoneRouteSegment('analyzing')).toBe('analyzing') // analyzing id == routeSegment
  })
})
