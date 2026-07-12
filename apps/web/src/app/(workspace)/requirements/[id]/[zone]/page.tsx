import { notFound } from 'next/navigation'
import {
  getZoneByRouteSegment,
  ZONE_META,
  ZONE_STATUS_COLOR_LABEL,
} from '@/lib/zones'
import { getExecutingData } from '@/lib/executing'
import { ExecutingZone } from '@/components/executing-zone'
import {
  getDraftingData,
  extractPrdOutline,
} from '@/lib/drafting'
import { DraftingZone } from '@/components/drafting-zone'
import { ZoneShell } from '@/lib/zone-shell'

/**
 * 工位主区。
 *
 * - generateStaticParams 预生成 6 个合法路由
 * - 未知 route_segment 由 [zone]/layout.tsx 拦截 notFound()
 * - 每个 zone page 自行包裹 ZoneShell,这样 page-fetched 数据(例如 DRAFTING 的
 *   PRD Markdown / 候命 Skill 列表)可以注入到 ResourceTree / InlineRail
 * - EXECUTING 工位(issue 17 样板)渲染 `<ExecutingZone />` 三列 Mission Control
 * - DRAFTING 工位(issue 18)渲染 `<DraftingZone />` Form 居中布局
 *   其余 4 工位 + 未对接工位(19-22)走占位实现,issue 19-22 替换
 */
export function generateStaticParams() {
  return ZONE_META.map((z) => ({ zone: z.route_segment }))
}

export default async function ZonePage({
  params,
}: {
  params: { id: string; zone: string }
}) {
  const zone = getZoneByRouteSegment(params.zone)
  if (!zone) notFound()

  // EXECUTING 工位样板:三列 Mission Control 布局
  if (zone.id === 'executing') {
    const data = await getExecutingData(params.id)
    return (
      <ZoneShell id={params.id} zone={zone}>
        <ExecutingZone data={data} />
      </ZoneShell>
    )
  }

  // DRAFTING 工位(issue 18):Form 居中布局 + 标题/PRD/AC/关联仓库
  if (zone.id === 'drafting') {
    const data = await getDraftingData(params.id)
    return (
      <ZoneShell
        id={params.id}
        zone={zone}
        prdSections={extractPrdOutline(data.prdMarkdown)}
        draftingSkills={data.skills}
        // 本期 mock:打开 Cmd+K 命令面板(后续接 agent API 时改为真正唤起 Skill)
        onSkillTrigger={() => {
          // TODO(后续):从 server 端无法触发 client 命令面板,改为 client-side SkillLauncher
          // 当前 mock 实现:InlineRail 收到回调后由 host 自行决定(此处仅占位)
        }}
      >
        <DraftingZone data={data} />
      </ZoneShell>
    )
  }

  // 其余 4 工位占位实现 — issue 19-22 替换
  const shellDesc =
    zone.has_resource_tree && zone.has_inline_rail
      ? '资源树 + Inline 栏(3 列)'
      : zone.has_resource_tree
        ? '资源树(2 列)'
        : zone.has_inline_rail
          ? 'Inline 栏(2 列)'
          : '主区全宽'

  return (
    <ZoneShell id={params.id} zone={zone}>
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
            占位实现 — 真实工位布局由 issue 18 (DRAFTING) / 19 (ANALYZING) / 20-22 (其他) 替换。
          </p>
        </header>
      </main>
    </ZoneShell>
  )
}