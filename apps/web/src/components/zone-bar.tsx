'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  ZONE_META,
  ZONE_LIFECYCLE_ORDER,
  ZONE_STATUS_COLOR_CLASS,
} from '@/lib/zones'

/**
 * ZoneBar — 7 Tab 顶部导航(ADR-0012 §6)。
 *
 * 规则:
 * - 仅在 /requirements/<id>/<zone>/ 路由下渲染(其他路由返回 null)
 * - 7 Tab 顺序:Overview → DRAFTING → ANALYZING → CLARIFYING → DESIGNING → EXECUTING → WRAP-UP
 * - 当前工位激活态:紫色 2px 底部下划线 + brand-600 文字色 + 加粗(ADR §6)
 * - ANALYZING 状态点脉动(ADR §6 决策 49)
 *
 * 视觉规格(ADR §6 决策):
 * - 高度 44px(h-11)
 * - 状态色点 6px(w-1.5 h-1.5)(对应决策 22)
 * - 当前工位:border-b-2 border-brand-600 + text-brand-600 + font-semibold
 */

// 仅捕获 /requirements/<id>/<zone>/ 这一层(id 不含 /,zone 不含 /)
const ZONE_ROUTE_RE = /^\/requirements\/([^/]+)\/([^/]+)\/?$/

export function ZoneBar() {
  const pathname = usePathname()
  const match = pathname.match(ZONE_ROUTE_RE)
  if (!match) return null
  const id = match[1]
  const seg = match[2]
  const active = ZONE_META.find((z) => z.route_segment === seg)
  if (!active) return null

  return (
    <nav
      data-testid="zone-bar"
      data-active-zone={active.id}
      className="flex items-center h-11 px-6 border-b border-border bg-bg-elevated"
      aria-label="工位导航"
    >
      <div className="flex items-center gap-1 flex-1">
        {/* Overview Tab */}
        <Link
          href={`/requirements/${id}/`}
          data-testid="zone-tab-overview"
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-sm text-text-2 hover:bg-bg-subtle"
        >
          <span>📊</span>
          <span>Overview</span>
        </Link>

        {/* 6 工位 Tab */}
        {ZONE_LIFECYCLE_ORDER.map((zoneId) => {
          const z = ZONE_META.find((meta) => meta.id === zoneId)!
          const isActive = z.route_segment === seg
          return (
            <Link
              key={z.id}
              href={`/requirements/${id}/${z.route_segment}/`}
              data-testid={`zone-tab-${z.id}`}
              data-active={String(isActive)}
              data-status-color={z.status_color}
              data-status-pulse={String(z.status_pulse)}
              className={[
                'relative flex items-center gap-1.5 h-8 px-3 rounded-md text-sm transition-colors',
                isActive
                  ? 'text-brand-600 font-semibold border-b-2 border-brand-600'
                  : 'text-text-2 hover:bg-bg-subtle',
              ].join(' ')}
            >
              <span>{z.icon}</span>
              <span>{z.name}</span>
              <span
                data-testid={`zone-status-${z.id}`}
                data-status-color={z.status_color}
                data-status-pulse={String(z.status_pulse)}
                className={[
                  'w-1.5 h-1.5 rounded-full',
                  ZONE_STATUS_COLOR_CLASS[z.status_color],
                  z.status_pulse ? 'animate-pulse' : '',
                ].join(' ')}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}