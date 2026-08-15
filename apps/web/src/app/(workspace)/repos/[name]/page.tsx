/**
 * /repos/[name] 详情页(SSR)—— issue 07 / ADR-0030 D6
 *
 * RSC 职责:
 * - 拉仓库注册表,找到对应 name(找不到 → notFound() 走 Next.js 404)
 * - 拉 usage(`GET /api/repos/:name/usage`)
 * - 把数据传给 client 组件 `RepoDetailView`
 *
 * 与 mock 时代对比:
 * - 旧:worktree 列表 + commit 列表 + 5 栏 stats
 * - 新:每个需求独立 clone,无 worktree 概念,展示「关联需求列表 + branch + 本地路径」
 *
 * 404 语义:注册表无此 name(典型场景:用户点了过期的链接)→ notFound(),
 * 与 detail-page 旧 fallback 到 repositories[0] 的「静默错位」行为相反(更可预测)。
 */

import { notFound } from 'next/navigation'
import {
  fetchRepoRegistryServer,
  fetchRepoUsageServer,
} from '@/lib/repos.server'
import { RepoDetailView } from './RepoDetailView'

export const dynamic = 'force-dynamic'

interface Props { params: { name: string }; }

export default async function RepoDetailPage({ params }: Props) {
  const repos = await fetchRepoRegistryServer()
  const repo = repos.find((r) => r.name === params.name)
  if (!repo) {
    notFound()
  }

  const usageRes = await fetchRepoUsageServer(params.name)
  // usageRes 为 null 的情况:fetchRepoUsageServer 仅在 404 时返 null;
  // 我们上面已经确认 repo 存在,所以理论上不会 null;兜底取空数组。
  const usage = usageRes?.usage ?? []

  return <RepoDetailView repo={repo} usage={usage} />
}
