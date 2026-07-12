import { describe, it, expect } from 'vitest'
import { inferZoneFromPathname } from '../use-zone'

/**
 * 纯函数 inferZoneFromPathname 单元测试(issue 16 · ADR-0012 §3)。
 *
 * 行为合约:
 * - /requirements/<id>/<zone>/            → kind='zone'
 * - /requirements/<id>/                  → kind='overview'
 * - /requirements/<id>/<unknown-zone>/    → kind='none'([zone]/layout 已 notFound,这里兜底)
 * - 其他路由(列表 / settings / dashboard) → kind='none'
 */

describe('inferZoneFromPathname', () => {
  describe('工位路由(zone)', () => {
    it('/requirements/REF-001/drafting/ 推断为 zone + drafting', () => {
      expect(inferZoneFromPathname('/requirements/REF-001/drafting/')).toMatchObject({
        kind: 'zone',
        id: 'REF-001',
        zoneId: 'drafting',
      })
    })

    it('/requirements/REF-001/executing 推断为 zone + executing', () => {
      expect(inferZoneFromPathname('/requirements/REF-001/executing')).toMatchObject({
        kind: 'zone',
        id: 'REF-001',
        zoneId: 'executing',
      })
    })

    it('/requirements/REF-001/wrap-up/ 推断为 zone + wrapup(route_segment 与 id 解耦)', () => {
      expect(inferZoneFromPathname('/requirements/REF-001/wrap-up/')).toMatchObject({
        kind: 'zone',
        id: 'REF-001',
        zoneId: 'wrapup',
      })
    })

    it('6 工位都能被识别', () => {
      for (const seg of [
        'drafting',
        'analyzing',
        'clarifying',
        'designing',
        'executing',
        'wrap-up',
      ]) {
        const loc = inferZoneFromPathname(`/requirements/r-001/${seg}/`)
        expect(loc.kind).toBe('zone')
      }
    })

    it('zone 字段附完整 ZoneMeta', () => {
      const loc = inferZoneFromPathname('/requirements/REF-001/wrap-up/')
      expect(loc.kind).toBe('zone')
      if (loc.kind === 'zone') {
        expect(loc.zone.id).toBe('wrapup')
        expect(loc.zone.thinking_bar).toBe('minimal')
      }
    })
  })

  describe('Overview 路由', () => {
    it('/requirements/REF-001/ 推断为 overview', () => {
      expect(inferZoneFromPathname('/requirements/REF-001/')).toEqual({
        kind: 'overview',
        id: 'REF-001',
      })
    })

    it('/requirements/REF-001(无尾 /)推断为 overview', () => {
      expect(inferZoneFromPathname('/requirements/REF-001')).toEqual({
        kind: 'overview',
        id: 'REF-001',
      })
    })
  })

  describe('未知 / 其他路由(none)', () => {
    it('/requirements/REF-001/unknown-zone/ 推断为 none(zone 名不合法)', () => {
      expect(inferZoneFromPathname('/requirements/REF-001/unknown-zone/')).toEqual({
        kind: 'none',
      })
    })

    it('/requirements/ 推断为 none(缺 id)', () => {
      expect(inferZoneFromPathname('/requirements/')).toEqual({
        kind: 'none',
      })
    })

    it('/requirements 推断为 none(根级)', () => {
      expect(inferZoneFromPathname('/requirements')).toEqual({
        kind: 'none',
      })
    })

    it('/requirements/REF-001/repos/ 推断为 none(子页面非工位)', () => {
      expect(inferZoneFromPathname('/requirements/REF-001/repos/')).toEqual({
        kind: 'none',
      })
    })

    it('/settings/ 推断为 none', () => {
      expect(inferZoneFromPathname('/settings/')).toEqual({ kind: 'none' })
    })

    it('/ 推断为 none', () => {
      expect(inferZoneFromPathname('/')).toEqual({ kind: 'none' })
    })

    it('空字符串推断为 none', () => {
      expect(inferZoneFromPathname('')).toEqual({ kind: 'none' })
    })
  })

  describe('路由深度兜底', () => {
    it('/requirements/REF-001/drafting/extra 不被识别为 zone(深度不匹配)', () => {
      // 防止 /requirements/<id>/<zone>/<extra>/ 误识别
      expect(inferZoneFromPathname('/requirements/REF-001/drafting/extra/')).toEqual({
        kind: 'none',
      })
    })
  })
})
