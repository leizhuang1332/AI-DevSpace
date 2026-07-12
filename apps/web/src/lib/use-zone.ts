'use client'

import { usePathname } from 'next/navigation'
import {
  getZoneByRouteSegment,
  REQUIREMENTS_ZONE_PATH_RE,
  REQUIREMENTS_OVERVIEW_PATH_RE,
  type ZoneMeta,
} from './zones'

/**
 * useZone — 从当前路由推断 zone 上下文(issue 16 · ADR-0012 §3)。
 *
 * 三种位置:
 * - kind='zone'     → /requirements/<id>/<zone>/  (工位路由)
 * - kind='overview' → /requirements/<id>/         (Overview 仪表板)
 * - kind='none'     → 其他(列表 / settings / 根 等)
 *
 * 设计:
 * - 拆为 inferZoneFromPathname 纯函数 + useZone hook,便于 TDD
 *   (无需 mock next/navigation,纯函数直接传 pathname 测试)
 * - 路由正则与 ZoneBar 共享,见 `REQUIREMENTS_ZONE_PATH_RE` 单源(`lib/zones.ts`)
 * - 路由长度兜底:`/requirements/<id>/<zone>/<extra>/` 不误识别
 * - 未知 zone segment → kind='none'(理论上被 [zone]/layout notFound 拦下)
 * - 永不基于 meta.yaml.status 推断(决策 15)
 */

export type ZoneLocation =
  | { kind: 'zone'; id: string; zoneId: string; zone: ZoneMeta }
  | { kind: 'overview'; id: string }
  | { kind: 'none' }

/**
 * 纯函数:从 pathname 推断当前 zone 位置。
 *
 * 规则(顺序敏感 —— 先匹配 zone 再匹配 overview):
 * 1. ZONE_ROUTE_RE 命中 + zone 合法 → kind='zone'
 * 2. ZONE_ROUTE_RE 命中 + zone 不合法 → kind='none'
 * 3. OVERVIEW_ROUTE_RE 命中 → kind='overview'
 * 4. 其他 → kind='none'
 */
export function inferZoneFromPathname(pathname: string): ZoneLocation {
  const zoneMatch = pathname.match(REQUIREMENTS_ZONE_PATH_RE)
  if (zoneMatch) {
    const [, id, seg] = zoneMatch
    const zone = getZoneByRouteSegment(seg)
    if (zone) {
      return { kind: 'zone', id, zoneId: zone.id, zone }
    }
    return { kind: 'none' }
  }
  const overviewMatch = pathname.match(REQUIREMENTS_OVERVIEW_PATH_RE)
  if (overviewMatch) {
    const [, id] = overviewMatch
    return { kind: 'overview', id }
  }
  return { kind: 'none' }
}

/**
 * Hook:从 next/navigation usePathname + inferZoneFromPathname 推断当前位置。
 *
 * 需在 Client Component 内使用(layout.tsx 已包裹 'use client',可直接调)。
 */
export function useZone(): ZoneLocation {
  const pathname = usePathname()
  return inferZoneFromPathname(pathname)
}
