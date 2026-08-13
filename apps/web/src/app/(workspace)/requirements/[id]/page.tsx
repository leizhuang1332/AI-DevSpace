import { OverviewPage } from '@/components/overview-page'
import { getRequirementOverviewFromFs } from '@/lib/requirement-overview.server'

/**
 * /requirements/[id]/ —— Overview 概览页(ADR-0012 §5 · 第 7 产品形态)
 *
 * 性质:仪表板,不是工位;无 ZoneBar、无资源树、无 Inline 栏(ADR §3)。
 * 内容:5 项(元数据 + 完成进度 + 工位地图 + 里程碑 + AI 活动 — ADR §5 推荐集)
 *
 * 数据:从 `getRequirementOverviewFromFs` 走 fs 直读(对齐 `drafting.server.ts`),
 * - `req-001` 仍走硬编码 REFUND_OVERVIEW mock(向后兼容)
 * - 其他 id:有 `requirement.md` + meta.yaml → 构造非空 OverviewData;
 *   否则 → emptyOverview(reqId) → UI 走"暂无数据"引导
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
  // 对齐 `[zone]/page.tsx` 的 `safeDecode` 范式:Next.js 14 dynamic route 对
  // 中文 reqId 不会自动 decodeURIComponent(实测 `req-003-这下可以了吧`
  // 路由 params.id 仍带 `%E8%BF%99...`)。不 decode 走 fs 拼路径会
  // `existsSync` miss → 误判 empty → UI 走"暂无数据"。
  const requirementId = safeDecode((params as { id: string }).id)
  const data = await getRequirementOverviewFromFs(requirementId)
  return <OverviewPage data={data} />
}

/**
 * 安全 decodeURIComponent:对已 decode 字符串、不含 `%XX` 的字符串是 no-op;
 * 仅在 `requirementId` 仍带 URL 编码时触发解码(对齐 `[zone]/page.tsx`
 * 的同名 helper,根因见那里注释)。
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}