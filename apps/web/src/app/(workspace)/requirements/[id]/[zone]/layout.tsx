import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getSectionByRouteSegment } from '@/lib/sections'

/**
 * 工位路由的 layout:只做一件事 —— 未知 zone segment → notFound()。
 *
 * 可视部分(ZoneShell + ResourceTree + InlineRail)由各 zone page.tsx 自行组装,
 * 这样 page.tsx 可以把 zone-specific 数据(例如 DRAFTING 的 PRD 大纲 / 候命 Skill 列表)
 * 注入到资源树 / Inline 栏,不需要在 layout 层做 zone 分支。
 *
 * 验收(issue 13):未知 route_segment → notFound(),由 layout 统一拦截。
 *
 * ADR-0026:解析函数从 `getZoneByRouteSegment` 迁移到 `getSectionByRouteSegment`
 * (4 section hardcode);段名 `[zone]` 不重命名(D3)。
 */
export default function ZoneLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { id: string; zone: string }
}) {
  const zone = getSectionByRouteSegment(params.zone)
  if (!zone) notFound()
  return <>{children}</>
}