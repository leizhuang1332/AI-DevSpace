'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  SECTION_META,
  REQUIREMENT_SECTIONS,
  type RequirementSection,
  SECTION_STATUS_COLOR_CLASS,
  REQUIREMENTS_ZONE_PATH_RE,
} from '@/lib/sections'

/**
 * ZoneBar — 5 Tab 顶部导航(ADR-0012 §6 · ADR-0026 D4:4 section + 1 Overview)。
 *
 * 规则:
 * - 仅在 /requirements/<id>/<zone>/ 路由下渲染(其他路由返回 null)
 * - 5 Tab 顺序:Overview → DRAFTING → BOARD → ANALYZING → WRAP-UP
 * - 当前工位激活态:紫色 2px 底部下划线 + brand-600 文字色 + 加粗(ADR §6)
 * - ANALYZING 状态点脉动(ADR §6 决策 49)
 *
 * 视觉规格(ADR §6 决策):
 * - 高度 44px(h-11)
 * - 状态色点 6px(w-1.5 h-1.5)(对应决策 22)
 * - 当前工位:border-b-2 border-brand-600 + text-brand-600 + font-semibold
 *
 * 路由正则 REQUIREMENTS_ZONE_PATH_RE(`lib/sections.ts` 单源)。
 *
 * 历史(ADR-0026):原 7 Tab(Overview + 6 工位)改为 5 Tab(Overview + 4 section);
 * CLARIFYING / DESIGNING / EXECUTING 三工位退役,purple-warn 状态色归 analyzing。
 */

export function ZoneBar() {
  const pathname = usePathname()
  const match = pathname.match(REQUIREMENTS_ZONE_PATH_RE)
  if (!match) return null
  const id = match[1]
  const seg = match[2]
  const active = (REQUIREMENT_SECTIONS as readonly string[])
    .map((sid) => SECTION_META[sid as RequirementSection])
    .find((z) => z.routeSegment === seg)
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

        {/* 4 section Tab */}
        {REQUIREMENT_SECTIONS.map((sectionId) => {
          const z = SECTION_META[sectionId]
          const isActive = z.routeSegment === seg
          return (
            <Link
              key={z.id}
              href={`/requirements/${id}/${z.routeSegment}/`}
              data-testid={`zone-tab-${z.id}`}
              data-active={String(isActive)}
              data-status-color={z.statusColor}
              data-status-pulse={String(z.statusPulse)}
              className={[
                'relative flex items-center gap-1.5 h-8 px-3 rounded-md text-sm transition-colors',
                isActive
                  ? 'text-brand-600 font-semibold border-b-2 border-brand-600'
                  : 'text-text-2 hover:bg-bg-subtle',
              ].join(' ')}
            >
              <span>{z.icon}</span>
              <span>{z.label}</span>
              <span
                data-testid={`zone-status-${z.id}`}
                data-status-color={z.statusColor}
                data-status-pulse={String(z.statusPulse)}
                className={[
                  'w-1.5 h-1.5 rounded-full',
                  SECTION_STATUS_COLOR_CLASS[z.statusColor],
                  z.statusPulse ? 'animate-pulse' : '',
                ].join(' ')}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}