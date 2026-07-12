import { describe, it, expect } from 'vitest'
import {
  ZONE_META,
  ZONE_LIFECYCLE_ORDER,
  DEFAULT_ZONE_ID,
  ZONE_STATUS_COLOR_CLASS,
  ZONE_STATUS_COLOR_LABEL,
  getZoneByRouteSegment,
  resolveDefaultZoneRouteSegment,
} from '../zones.js'

describe('ZONE_META', () => {
  it('导出 6 个工位元数据', () => {
    expect(ZONE_META).toHaveLength(6)
  })

  it('每个工位含必要 UI 字段', () => {
    for (const z of ZONE_META) {
      expect(z.id).toBeTypeOf('string')
      expect(z.id.length).toBeGreaterThan(0)
      expect(z.name).toBeTypeOf('string')
      expect(z.name.length).toBeGreaterThan(0)
      expect(z.display_name).toBeTypeOf('string')
      expect(z.display_name.length).toBeGreaterThan(0)
      expect(z.icon).toBeTypeOf('string')
      expect(z.icon.length).toBeGreaterThan(0)
      expect(z.route_segment).toBeTypeOf('string')
      expect(z.route_segment.length).toBeGreaterThan(0)
      expect(z.has_resource_tree).toBeTypeOf('boolean')
      expect(z.has_inline_rail).toBeTypeOf('boolean')
      expect(['gray', 'blue', 'purple', 'yellow', 'green', 'red', 'purple-warn']).toContain(z.status_color)
      expect(z.status_pulse).toBeTypeOf('boolean')
      expect(['required', 'minimal', 'hidden']).toContain(z.thinking_bar)
      expect(typeof z.description).toBe('string')
    }
  })

  it('route_segment 唯一', () => {
    const segs = ZONE_META.map((z) => z.route_segment)
    expect(new Set(segs).size).toBe(segs.length)
  })

  it('id 唯一', () => {
    const ids = ZONE_META.map((z) => z.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('6 工位的 resource_tree / inline_rail 组合符合 ADR-0012 §4 默认值表', () => {
    const tree = Object.fromEntries(ZONE_META.map((z) => [z.id, z.has_resource_tree]))
    const rail = Object.fromEntries(ZONE_META.map((z) => [z.id, z.has_inline_rail]))
    expect(tree.drafting).toBe(true)
    expect(tree.analyzing).toBe(false)
    expect(tree.clarifying).toBe(false)
    expect(tree.designing).toBe(false)
    expect(tree.executing).toBe(true)
    expect(tree.wrapup).toBe(true)
    expect(rail.drafting).toBe(true)
    expect(rail.analyzing).toBe(false)
    expect(rail.clarifying).toBe(false)
    expect(rail.designing).toBe(false)
    expect(rail.executing).toBe(true)
    expect(rail.wrapup).toBe(false)
  })

  it('status_pulse 仅 ANALYZING 为 true(ADR §6 决策 49)', () => {
    const pulse = Object.fromEntries(ZONE_META.map((z) => [z.id, z.status_pulse]))
    expect(pulse.analyzing).toBe(true)
    expect(pulse.drafting).toBe(false)
    expect(pulse.clarifying).toBe(false)
    expect(pulse.designing).toBe(false)
    expect(pulse.executing).toBe(false)
    expect(pulse.wrapup).toBe(false)
  })
})

describe('ZONE_STATUS_COLOR_CLASS / ZONE_STATUS_COLOR_LABEL', () => {
  it('ZONE_STATUS_COLOR_CLASS 覆盖全部 7 种状态色', () => {
    expect(Object.keys(ZONE_STATUS_COLOR_CLASS).sort()).toEqual([
      'blue',
      'gray',
      'green',
      'purple',
      'purple-warn',
      'red',
      'yellow',
    ])
  })

  it('purple-warn 含 ring 类(CLARIFYING 特殊标记)', () => {
    expect(ZONE_STATUS_COLOR_CLASS['purple-warn']).toContain('ring-')
    expect(ZONE_STATUS_COLOR_CLASS['purple-warn']).toContain('red-')
  })

  it('ZONE_STATUS_COLOR_LABEL 7 种均有中文标签', () => {
    expect(Object.keys(ZONE_STATUS_COLOR_LABEL)).toHaveLength(7)
    for (const label of Object.values(ZONE_STATUS_COLOR_LABEL)) {
      expect(label).toBeTypeOf('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('ZONE_LIFECYCLE_ORDER', () => {
  it('顺序为 drafting → analyzing → clarifying → designing → executing → wrapup', () => {
    expect(ZONE_LIFECYCLE_ORDER).toEqual([
      'drafting',
      'analyzing',
      'clarifying',
      'designing',
      'executing',
      'wrapup',
    ])
  })

  it('与 ZONE_META 中 id 集合一致', () => {
    expect(new Set(ZONE_LIFECYCLE_ORDER)).toEqual(new Set(ZONE_META.map((z) => z.id)))
  })
})

describe('DEFAULT_ZONE_ID', () => {
  it('默认 drafting', () => {
    expect(DEFAULT_ZONE_ID).toBe('drafting')
  })
})

describe('getZoneByRouteSegment', () => {
  it('合法 route_segment 返回对应工位', () => {
    expect(getZoneByRouteSegment('drafting')?.id).toBe('drafting')
    expect(getZoneByRouteSegment('analyzing')?.id).toBe('analyzing')
    expect(getZoneByRouteSegment('clarifying')?.id).toBe('clarifying')
    expect(getZoneByRouteSegment('designing')?.id).toBe('designing')
    expect(getZoneByRouteSegment('executing')?.id).toBe('executing')
    expect(getZoneByRouteSegment('wrap-up')?.id).toBe('wrapup')
  })

  it('未知 route_segment 返回 null', () => {
    expect(getZoneByRouteSegment('unknown-zone')).toBeNull()
    expect(getZoneByRouteSegment('')).toBeNull()
    expect(getZoneByRouteSegment('DRAFTING')).toBeNull() // case-sensitive
  })

  it('route_segment 与 id 解耦:wrap-up route 对应 wrapup id', () => {
    // 这是 ADR §9 的有意识设计:id 是程序内部名,route_segment 是 URL 片段
    const z = getZoneByRouteSegment('wrap-up')
    expect(z?.id).toBe('wrapup')
  })
})

describe('resolveDefaultZoneRouteSegment', () => {
  it('cookie 缺失 → 默认 drafting route', () => {
    expect(resolveDefaultZoneRouteSegment(undefined)).toBe('drafting')
  })

  it('cookie 为合法 route_segment → 使用 cookie 值', () => {
    expect(resolveDefaultZoneRouteSegment('executing')).toBe('executing')
    expect(resolveDefaultZoneRouteSegment('wrap-up')).toBe('wrap-up')
  })

  it('cookie 为未知值 → fallback 默认 drafting', () => {
    expect(resolveDefaultZoneRouteSegment('garbage')).toBe('drafting')
    expect(resolveDefaultZoneRouteSegment('DRAFTING')).toBe('drafting')
  })

  it('永不基于 id 推断(决策 15 反对状态机:cookie 若写 id 而非 route_segment 也不会被误识别)', () => {
    // cookie 写 id 而非 route_segment 不应误用
    expect(resolveDefaultZoneRouteSegment('wrapup')).toBe('drafting')
  })
})

// ============================================================================
// ANALYZING 工位注册表(issue 19a VS1 验收 — ADR-0013 工位注册表更新)
// ============================================================================

describe('ANALYZING 工位注册表(issue 19a VS1)', () => {
  const analyzing = ZONE_META.find((z) => z.id === 'analyzing')

  it('ANALYZING display_name 改为"PRD 准入 + 技术概要"', () => {
    expect(analyzing?.display_name).toBe('PRD 准入 + 技术概要')
  })

  it('ANALYZING main_layout 改为 admission-workbench', () => {
    expect(analyzing?.main_layout).toBe('admission-workbench')
  })

  it('ANALYZING default_arming 含 admission-check + tech-brief-scaffold', () => {
    expect(analyzing?.default_arming).toEqual(
      expect.arrayContaining(['admission-check', 'tech-brief-scaffold']),
    )
  })

  it('ANALYZING icon 改为 🧠(原 🔍)', () => {
    expect(analyzing?.icon).toBe('🧠')
  })

  it('其他 5 工位 main_layout 未显式设置(undefined,保持向后兼容)', () => {
    const others = ZONE_META.filter((z) => z.id !== 'analyzing')
    for (const z of others) {
      expect(z.main_layout).toBeUndefined()
      expect(z.default_arming).toBeUndefined()
    }
  })
})