import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveDefaultZoneRouteSegment } from '@/lib/zones'

/**
 * /requirements/[id]/ 入口(ADR-0012 §8 重定向逻辑):
 * - cookie `last_zone` 存在且合法 → 用 cookie 指定的工位
 * - 否则默认 drafting(lifecycle 起点)
 * - 永不基于 meta.yaml.status 推断(决策 15 反对状态机)
 *
 * 解析逻辑委托给 resolveDefaultZoneRouteSegment(纯函数,有单元测试)。
 */
export default function RequirementEntry({
  params,
}: {
  params: { id: string }
}) {
  const cookieStore = cookies()
  const lastZone = cookieStore.get('last_zone')?.value
  const target = resolveDefaultZoneRouteSegment(lastZone)
  redirect(`/requirements/${params.id}/${target}/`)
}