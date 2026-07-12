import { OverviewPage } from '@/components/overview-page'
import { getRequirementOverview } from '@/lib/requirement-overview'

/**
 * /requirements/[id]/ —— Overview 概览页(ADR-0012 §5 · 第 7 产品形态)
 *
 * 性质:仪表板,不是工位;无 ZoneBar、无资源树、无 Inline 栏(ADR §3)。
 * 内容:5 项(元数据 + 完成进度 + 工位地图 + 里程碑 + AI 活动 — ADR §5 推荐集)
 *
 * 数据:从 getRequirementOverview 异步拉取(mock 期,后续接 agent API)。
 *
 * 注意:本路由不再做重定向 —— 重定向逻辑只用于尚未实现工位时的过渡,
 * 现在 6 工位都已可访问,Overview 是默认落地。
 * ZoneBar 的 Overview Tab 跳到本路由,会渲染概览页(ZoneBar 此时不渲染,见 ADR §5)。
 */
export default async function RequirementOverview({
  params,
}: {
  params: { id: string }
}) {
  const data = await getRequirementOverview(params.id)
  return <OverviewPage data={data} />
}