import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getZoneByRouteSegment } from '@/lib/zones'
import { ZoneShell } from '@/lib/zone-shell'

/**
 * 工位专属 shell(ADR-0012 §4):
 * - 未知 zone segment → notFound()(issue 13 验收第 3 条)
 * - 按 zone.has_resource_tree 决定是否渲染资源树
 * - 按 zone.has_inline_rail 决定是否渲染 Inline 栏
 * - 主区交给 page.tsx 的工位布局
 *
 * 可视部分委托给 ZoneShell(纯组件,便于测试)。
 */
export default function ZoneLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { id: string; zone: string }
}) {
  const zone = getZoneByRouteSegment(params.zone)
  if (!zone) notFound()

  return (
    <ZoneShell id={params.id} zone={zone}>
      {children}
    </ZoneShell>
  )
}