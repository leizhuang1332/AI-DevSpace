import { notFound } from 'next/navigation'
import {
  getZoneByRouteSegment,
  ZONE_META,
  ZONE_STATUS_COLOR_LABEL,
} from '@/lib/zones'

/**
 * 工位主区(占位实现 — issue 17+ 替换为真实工位布局组件)。
 *
 * - generateStaticParams 预生成 6 个合法路由
 * - 未知 route_segment 已被 [zone]/layout.tsx 拦下,这里再做一次 notFound 兜底
 */
export function generateStaticParams() {
  return ZONE_META.map((z) => ({ zone: z.route_segment }))
}

export default function ZonePage({
  params,
}: {
  params: { id: string; zone: string }
}) {
  const zone = getZoneByRouteSegment(params.zone)
  if (!zone) notFound()

  const shellDesc =
    zone.has_resource_tree && zone.has_inline_rail
      ? '资源树 + Inline 栏(3 列)'
      : zone.has_resource_tree
        ? '资源树(2 列)'
        : zone.has_inline_rail
          ? 'Inline 栏(2 列)'
          : '主区全宽'

  return (
    <main
      data-testid="zone-page"
      data-zone-id={zone.id}
      className="overflow-auto p-8"
    >
      <header className="max-w-[880px]">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">{zone.icon}</span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {zone.name}{' '}
            <span className="text-text-3 text-lg font-normal">
              · {zone.display_name}
            </span>
          </h1>
        </div>
        <p className="text-text-2 mb-6">{zone.description}</p>

        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm bg-bg-subtle border border-border rounded-lg p-4 max-w-[560px]">
          <dt className="text-text-3">requirement</dt>
          <dd className="font-mono">{params.id}</dd>
          <dt className="text-text-3">status_color</dt>
          <dd>{ZONE_STATUS_COLOR_LABEL[zone.status_color]}</dd>
          <dt className="text-text-3">status_pulse</dt>
          <dd>{zone.status_pulse ? '是' : '否'}</dd>
          <dt className="text-text-3">thinking_bar</dt>
          <dd>{zone.thinking_bar}</dd>
          <dt className="text-text-3">shell</dt>
          <dd>{shellDesc}</dd>
        </dl>

        <p className="text-text-3 text-xs mt-6">
          占位实现 — 真实工位布局由 issue 17 (EXECUTING) / 18 (DRAFTING) / 19-22 (其他) 替换。
        </p>
      </header>
    </main>
  )
}