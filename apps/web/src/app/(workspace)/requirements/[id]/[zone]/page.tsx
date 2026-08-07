import { notFound } from 'next/navigation'
import {
  getSectionByRouteSegment,
  SECTION_META,
  REQUIREMENT_SECTIONS,
  SECTION_STATUS_COLOR_LABEL,
} from '@/lib/sections'
import { getAnalyzingData } from '@/lib/analyzing.server'
import { AnalyzingZone } from '@/components/analyzing-zone'
import { getDraftingDataFromFs } from '@/lib/drafting.server'
import { DraftingZone } from '@/components/drafting-zone'
import { DraftingSkillRail } from '@/components/drafting-skill-rail'
import {
  getWrapupData,
  extractWrapupTreeSummary,
} from '@/lib/wrapup'
import { WrapupZone } from '@/components/wrapup-zone'
import { ZoneShell } from '@/lib/zone-shell'

/**
 * 工位主区(ADR-0026 D3:4 section contract)。
 *
 * - generateStaticParams 预生成 4 个合法路由(drafting / board / analyzing / wrapup)
 * - 未知 routeSegment 由 [zone]/layout.tsx 拦截 notFound()
 * - 每个 zone page 自行包裹 ZoneShell,这样 page-fetched 数据(例如 DRAFTING 的
 *   候命 Skill 列表)可以注入到 InlineRail
 * - DRAFTING 工位(issue 18 / issue 01 重新设计)渲染 `<DraftingZone />` Form 居中
 *   布局,主区仅 1 列 + 右侧 Inline 栏(Skill 候命)
 * - BOARD section(ADR-0027)本期占位页,真实 5 列看板 UI 留后续 PRD phase
 * - ANALYZING 工位(issue 08 · ADR-0021)渲染 `<AnalyzingZone />` Analysis Run + Issue + Response
 * - WRAP-UP 工位(issue 22)渲染 `<WrapupZone />` Archive 形态
 *
 * 退役(ADR-0027 D1):CLARIFYING / DESIGNING / EXECUTING 三工位路由 + 组件 +
 * 数据加载全部退役;功能吸收到 BOARD section 的 TaskCard 5 态推进 + 父
 * Requirement.status 联动 + 父 analyzing transcript 跑 Run。
 */
export function generateStaticParams() {
  return REQUIREMENT_SECTIONS.map((id) => ({
    zone: SECTION_META[id].routeSegment,
  }))
}

/**
 * 安全 decodeURIComponent:对已 decode 字符串、不含 `%XX` 的字符串是 no-op;
 * 仅在 `requirementId / params.zone` 仍带 URL 编码时(实测 Next.js 14 dynamic
 * route 对中文 reqId 不会自动 decode)触发解码,真正修正路径解析。
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export default async function ZonePage({
  params,
}: {
  params: { id: string; zone: string }
}) {
  // Next.js 14 dynamic route 的 params 在某些编码路径下不会自动 decodeURIComponent
  // (实测:`/requirements/req-007-test%E6%89%98.../drafting` 的 requirementId 仍带 `%XX`),
  // 导致中文 reqId 拼路径时报"文件不存在" → drafting 进 emptyDrafting → 闪骨架
  // (bug 3 真正根因)。这里加一层兜底 decode;`decodeURIComponent` 对已 decode 字符串
  // 是 no-op,对不含 `%` 的字符串也是 no-op,只在 `%XX` 形式时触发解码,安全。
  const requirementId = safeDecode((params as { id: string }).id)
  const zoneSegment = safeDecode((params as { zone: string }).zone)
  const zone = getSectionByRouteSegment(zoneSegment)
  if (!zone) notFound()

  // DRAFTING 工位(issue 18 / issue 01 重新设计):Form 居中布局 + 标题/PRD/AC/关联仓库
  // 主区 1 列 + 右侧 Inline 栏(Skill 候命) —— 不再渲染左 240px 资源树
  //
  // zone-data-fidelity-fixes/01 — 改用 server-only `getDraftingDataFromFs`,
  // 让真实新建需求(`requirement.md` 超过 10 字节)进入 DRAFTING 拿到非空数据
  // (prdMarkdown = 文件内容),不再闪 1.5s 骨架 overlay。
  // `drafting.ts` 里的 mock `getDraftingData` 保留,组件测试继续依赖它。
  if (zone.id === 'drafting') {
    const data = await getDraftingDataFromFs(requirementId)
    return (
      <ZoneShell
        id={requirementId}
        zone={zone}
        // 用 client 包装器替代默认 InlineRail —— 因为 Skill 点击需要函数回调
        // (server component 不能直接传函数 prop)
        inlineRailSlot={
          <DraftingSkillRail
            requirementId={requirementId}
            skills={data.skills}
          />
        }
      >
        <DraftingZone data={data} />
      </ZoneShell>
    )
  }

  // BOARD section(ADR-0027 D2):本期占位页,真实 5 列看板 UI(列布局 / 卡片 /
  // 详情页 / PRD 拆解 modal)留后续 PRD phase。占位页让 `/requirements/[id]/board/`
  // 可访问不 404,ZoneBar 的 BOARD Tab 激活态正确。
  if (zone.id === 'board') {
    return (
      <ZoneShell id={requirementId} zone={zone}>
        <main
          data-testid="zone-page"
          data-zone-id={zone.id}
          className="overflow-auto p-8"
        >
          <header className="max-w-[880px]">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{zone.icon}</span>
              <h1 className="text-2xl font-semibold tracking-tight">
                {zone.label}{' '}
                <span className="text-text-3 text-lg font-normal">
                  · {zone.displayName}
                </span>
              </h1>
            </div>
            <p className="text-text-2 mb-6">{zone.description}</p>
            <p className="text-text-3 text-xs">
              BOARD section 即将上线 —— 5 列看板(backlog / todo / in_progress /
              in_review / done)+ 卡片详情页 + PRD 拆解(ADR-0027)。
            </p>
          </header>
        </main>
      </ZoneShell>
    )
  }

  // ANALYZING 工位(issue 08 · ADR-0021):Analysis Skill + Run + Issue + Response
  // 主区全宽(zone.hasResourceTree = false, hasInlineRail = false → grid-cols-1)
  if (zone.id === 'analyzing') {
    const data = await getAnalyzingData(requirementId)
    return (
      <ZoneShell id={requirementId} zone={zone}>
        <AnalyzingZone data={data} />
      </ZoneShell>
    )
  }

  // WRAP-UP 工位(issue 22):Archive 形态
  // - 主区全宽(无 Inline 栏),资源树由 ZoneShell 自动渲染
  //   (zone.hasResourceTree = true, hasInlineRail = false → grid-cols-[240px_1fr])
  // - 资源树显示产物清单 + PR/Commit + 决策回顾(由 WrapupZone 派生 WrapupTreeSummary
  //   注入 ResourceTree —— 避免 ResourceTree 重复拉数据)
  // - 顶部回顾报告 hero + AC 通过情况 + 产物清单卡片 + PR 列表 + 决策回顾
  //   + 变更统计 + 归档操作([📦 归档] / [🔄 重新打开])
  // - onArchive / onReopen 为 client 回调(默认 no-op),后续接 agent API
  //   时包一层 client wrapper 注入回调。
  if (zone.id === 'wrapup') {
    const data = await getWrapupData(requirementId)
    return (
      <ZoneShell
        id={requirementId}
        zone={zone}
        wrapupSummary={extractWrapupTreeSummary(data)}
      >
        <WrapupZone data={data} />
      </ZoneShell>
    )
  }

  // 兜底:理论不会到达(layout 已 notFound),防御性渲染
  const shellDesc =
    zone.hasResourceTree && zone.hasInlineRail
      ? '资源树 + Inline 栏(3 列)'
      : zone.hasResourceTree
        ? '资源树(2 列)'
        : zone.hasInlineRail
          ? 'Inline 栏(2 列)'
          : '主区全宽'

  return (
    <ZoneShell id={requirementId} zone={zone}>
      <main
        data-testid="zone-page"
        data-zone-id={zone.id}
        className="overflow-auto p-8"
      >
        <header className="max-w-[880px]">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{zone.icon}</span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {zone.label}{' '}
              <span className="text-text-3 text-lg font-normal">
                · {zone.displayName}
              </span>
            </h1>
          </div>
          <p className="text-text-2 mb-6">{zone.description}</p>

          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm bg-bg-subtle border border-border rounded-lg p-4 max-w-[560px]">
            <dt className="text-text-3">requirement</dt>
            <dd className="font-mono">{requirementId}</dd>
            <dt className="text-text-3">statusColor</dt>
            <dd>{SECTION_STATUS_COLOR_LABEL[zone.statusColor]}</dd>
            <dt className="text-text-3">statusPulse</dt>
            <dd>{zone.statusPulse ? '是' : '否'}</dd>
            <dt className="text-text-3">shell</dt>
            <dd>{shellDesc}</dd>
          </dl>

          <p className="text-text-3 text-xs mt-6">
            占位实现 —— 4 section(drafting / board / analyzing / wrapup)均已落地。
          </p>
        </header>
      </main>
    </ZoneShell>
  )
}
