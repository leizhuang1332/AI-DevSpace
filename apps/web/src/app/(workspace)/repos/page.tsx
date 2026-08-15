/**
 * /repos 列表页(SSR)—— issue 07 / ADR-0030 D6
 *
 * RSC 职责:
 * - 拉仓库注册表(`GET /api/repos`)
 * - 批量并发拉每个仓库的 usage(`GET /api/repos/:name/usage`)
 * - 把数据通过 props 传给 client 组件 `ReposList` 处理交互
 *
 * 与 mock 时代对比:
 * - 旧:从物理目录 mock 数组派生
 * - 新:Agent 实时读 `~/.aidevspace/repos.yaml`(决策 Q2),并发派生 usage
 * - 列表文案:「N 个仓库 · M 个 worktree」→「注册表 · N 个仓库」(ADR-0030 D6)
 * - placeholder:「搜索仓库名 / URL / 分支…」→「搜索仓库名 / 地址 / 描述…」(决策 C2)
 *
 * 错误兜底:
 * - registry 拉失败 → throw(让 Next.js 走 error.tsx;SSR 失败比静默降级更安全)
 * - 单个 usage 拉失败 → `fetchAllRepoUsageServer` 内部静默降级为 usage=0
 */

import type { CodebaseUsageEntry } from '@ai-devspace/shared'
import { fetchRepoRegistryServer, fetchAllRepoUsageServer } from '@/lib/repos.server'
import { ReposList } from './ReposList'

export const dynamic = 'force-dynamic'

export default async function ReposPage() {
  const repos = await fetchRepoRegistryServer()
  const usageMap = await fetchAllRepoUsageServer(repos)
  const usageByName: Record<string, CodebaseUsageEntry[]> = {}
  for (const [name, value] of usageMap.entries()) {
    usageByName[name] = value.usage
  }
  // 缺 usage 的仓库 → 空数组(usageMap.entries() 不含,RepsList 内部按 r.name ?? [] 兜底)
  for (const r of repos) {
    if (!(r.name in usageByName)) usageByName[r.name] = []
  }
  return <ReposList repos={repos} usageByName={usageByName} />
}
