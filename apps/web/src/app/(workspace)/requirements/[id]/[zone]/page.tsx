import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  getZoneByRouteSegment,
  ZONE_META,
  ZONE_STATUS_COLOR_LABEL,
} from '@/lib/zones'
import { getExecutingData } from '@/lib/executing'
import { ExecutingZone } from '@/components/executing-zone'
import { getAnalyzingData } from '@/lib/analyzing.server'
import { AnalyzingZone } from '@/components/analyzing-zone'
import { getDraftingDataFromFs } from '@/lib/drafting.server'
import { DraftingZone } from '@/components/drafting-zone'
import { DraftingSkillRail } from '@/components/drafting-skill-rail'
import { getClarifyingData } from '@/lib/clarifying'
import { ClarifyingZone } from '@/components/clarifying-zone'
import { getDesigningData } from '@/lib/designing'
import { DesigningZone } from '@/components/designing-zone'
import {
  getWrapupData,
  extractWrapupTreeSummary,
} from '@/lib/wrapup'
import { WrapupZone } from '@/components/wrapup-zone'
import { ZoneShell } from '@/lib/zone-shell'

/**
 * 工位主区。
 *
 * - generateStaticParams 预生成 6 个合法路由
 * - 未知 route_segment 由 [zone]/layout.tsx 拦截 notFound()
 * - 每个 zone page 自行包裹 ZoneShell,这样 page-fetched 数据(例如 DRAFTING 的
 *   候命 Skill 列表)可以注入到 InlineRail
 * - EXECUTING 工位(issue 17 样板)渲染 `<ExecutingZone />` 三列 Mission Control
 * - DRAFTING 工位(issue 18 / issue 01 重新设计)渲染 `<DraftingZone />` Form 居中
 *   布局,主区仅 1 列 + 右侧 Inline 栏(Skill 候命)
 * - ANALYZING 工位(issue 19)渲染 `<AnalyzingZone />` Thinking 大屏 + 打字机流
 * - CLARIFYING 工位(issue 20)渲染 `<ClarifyingZone />` Q&A 主区
 * - DESIGNING 工位(issue 21)渲染 `<DesigningZone />` Compare 主区
 * - WRAP-UP 工位(issue 22)渲染 `<WrapupZone />` Archive 形态
 *
 * issue 01 后:DRAFTING 不再注入 `prdSections` —— ZoneShell / ResourceTree 已
 * 移除 PRD-outline 分支,DRAFTING 改为单主区 + 右侧 Inline 栏布局。
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

  // DRAFTING 工位(issue 18 / issue 01 重新设计):Form 居中布局 + 标题/PRD/AC/关联仓库
  // 主区 1 列 + 右侧 Inline 栏(Skill 候命) —— 不再渲染左 240px 资源树
  //
  // zone-data-fidelity-fixes/01 — 改用 server-only `getDraftingDataFromFs`,
  // 让真实新建需求(`requirement.md` 超过 10 字节)进入 DRAFTING 拿到非空数据
  // (prdMarkdown = 文件内容),不再闪 1.5s 骨架 overlay。
  // `drafting.ts` 里的 mock `getDraftingData` 保留,组件测试继续依赖它。
  if (zone.id === 'drafting') {
    const data = await getDraftingDataFromFs(params.id)
    return (
      <ZoneShell
        id={params.id}
        zone={zone}
        // 用 client 包装器替代默认 InlineRail —— 因为 Skill 点击需要函数回调
        // (server component 不能直接传函数 prop)
        inlineRailSlot={
          <DraftingSkillRail
            requirementId={params.id}
            skills={data.skills}
          />
        }
      >
        <DraftingZone data={data} />
      </ZoneShell>
    )
  }

  // ANALYZING 工位(issue 19):Thinking 大屏 + 打字机思考流
  // 主区全宽(zone.has_resource_tree = false, has_inline_rail = false → grid-cols-1)
  // VS3 多会话(issue 19c):activeSessionId 默认值 = cookie `last_session_id`
  // (客户端切 Tab 时写入;SSR 通过 cookies() 注入)
  if (zone.id === 'analyzing') {
    const cookieStore = cookies()
    const lastSessionId = cookieStore.get('last_session_id')?.value
    const data = await getAnalyzingData(params.id, {
      ...(lastSessionId ? { lastSessionId } : {}),
    })
    return (
      <ZoneShell id={params.id} zone={zone}>
        <AnalyzingZone data={data} />
      </ZoneShell>
    )
  }

  // CLARIFYING 工位(issue 20):Q&A 主区(主区全宽)
  // server-fetched data 通过 props 注入;候选答案 / 自定义回答 / 历史回看的 client 交互
  // 由 ClarifyingZone 内部 useState 管理(onAnswer / onBack 为可选,默认 no-op)。
  // 后续接 agent API 时,包一层 client wrapper(类似 DRAFTING 的 DraftingSkillRail)注入回调即可。
  if (zone.id === 'clarifying') {
    const data = await getClarifyingData(params.id)
    return (
      <ZoneShell id={params.id} zone={zone}>
        <ClarifyingZone data={data} />
      </ZoneShell>
    )
  }

  // DESIGNING 工位(issue 21):Compare 形态(主区全宽,符合 ADR-0011 R2 默认无资源树)
  // - 左侧设计文档(markdown)+ 右侧 3 个候选方案卡片横向对比
  // - 底部"取舍点详情 + AI 建议" + 自定义调整输入框
  // - onSelect / onRegenerate 为 client 回调(默认 no-op),后续接 agent API
  //   时包一层 client wrapper(类似 DRAFTING 的 DraftingSkillRail)注入回调。
  if (zone.id === 'designing') {
    const data = await getDesigningData(params.id)
    return (
      <ZoneShell id={params.id} zone={zone}>
        <DesigningZone data={data} />
      </ZoneShell>
    )
  }

  // WRAP-UP 工位(issue 22):Archive 形态
  // - 主区全宽(无 Inline 栏),资源树由 ZoneShell 自动渲染
  //   (zone.has_resource_tree = true, has_inline_rail = false → grid-cols-[240px_1fr])
  // - 资源树显示产物清单 + PR/Commit + 决策回顾(由 WrapupZone 派生 WrapupTreeSummary
  //   注入 ResourceTree —— 避免 ResourceTree 重复拉数据)
  // - 顶部回顾报告 hero + AC 通过情况 + 产物清单卡片 + PR 列表 + 决策回顾
  //   + 变更统计 + 归档操作([📦 归档] / [🔄 重新打开])
  // - onArchive / onReopen 为 client 回调(默认 no-op),后续接 agent API
  //   时包一层 client wrapper 注入回调。
  if (zone.id === 'wrapup') {
    const data = await getWrapupData(params.id)
    return (
      <ZoneShell
        id={params.id}
        zone={zone}
        wrapupSummary={extractWrapupTreeSummary(data)}
      >
        <WrapupZone data={data} />
      </ZoneShell>
    )
  }

  // 其余 1 工位占位实现 — 后续 issue 替换(目前 6 工位均已落地)
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