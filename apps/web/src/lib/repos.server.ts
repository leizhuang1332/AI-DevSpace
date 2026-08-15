/**
 * 仓库注册表 server-side fetch(RSC 专用)
 *
 * issue 07 / ADR-0030 D6:/repos 列表页 + /repos/[name] 详情页 SSR 走这里。
 * 同 ticket 07b 决策 D1:RSC 内不走 agentFetch(无 document,无法 bootstrap),
 * 而是直接 fetch agent server + 手动传授权头。
 *
 * 调用方:
 * - `(workspace)/repos/page.tsx`(列表 + 关联需求数)
 * - `(workspace)/repos/[name]/page.tsx`(详情页仓库信息 + 完整 usage)
 *
 * 注意:
 * - 仅 server-side 使用(client component import 会触发 webpack UnhandledSchemeError)
 * - `cache: 'no-store'` 防 RSC 永久缓存
 */

import {
  RepoRegistryResponseSchema,
  RepoUsageResponseSchema,
  type RepoRegistryEntry,
  type RepoUsageResponse,
} from '@ai-devspace/shared'
import { getServerAgentToken } from './server-agent-token'

const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

export class ServerReposError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly context: string,
  ) {
    super(`ServerRepos[${context}] ${status}: ${JSON.stringify(body)}`)
    this.name = 'ServerReposError'
  }
}

/** RSC 内拉取仓库注册表全量 */
export async function fetchRepoRegistryServer(): Promise<RepoRegistryEntry[]> {
  const token = getServerAgentToken()
  if (!token) {
    throw new ServerReposError(401, { error: 'no_auth' }, 'fetchRepoRegistryServer')
  }

  const res = await fetch(`${AGENT_BASE}/api/repos`, {
    headers: { 'x-aidevspace-token': token },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ServerReposError(res.status, body, 'fetchRepoRegistryServer')
  }

  const raw = await res.json()
  return RepoRegistryResponseSchema.parse(raw).repos
}

/**
 * RSC 内拉取单个仓库的「被 N 个需求使用」列表。
 *
 * 失败语义:
 * - 404 E_REPO_NOT_FOUND → 返 null(列表页 SSR 用法:逐个并发拉,某个仓库不存在即跳过)
 * - 其他错 → 抛 ServerReposError(让 caller 决定怎么兜底,如列表页降级为 usage=0)
 *
 * 列表页通常用 `fetchAllRepoUsageServer(entries)` 批量并发拉,失败仓库降级 0。
 */
export async function fetchRepoUsageServer(
  repoName: string,
): Promise<RepoUsageResponse | null> {
  const token = getServerAgentToken()
  if (!token) {
    throw new ServerReposError(401, { error: 'no_auth' }, 'fetchRepoUsageServer')
  }

  const res = await fetch(
    `${AGENT_BASE}/api/repos/${encodeURIComponent(repoName)}/usage`,
    {
      headers: { 'x-aidevspace-token': token },
      cache: 'no-store',
    },
  )

  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ServerReposError(res.status, body, 'fetchRepoUsageServer')
  }

  const raw = await res.json()
  return RepoUsageResponseSchema.parse(raw)
}

/**
 * 批量并发拉所有仓库的 usage —— 列表页 SSR 用法。
 *
 * 失败兜底策略:某仓库拉失败(非 404)→ 记 console.warn + 该仓库 usage=0,
 * 让列表页正常渲染。其他错误(401 等全局错)→ 整批抛错让上层兜底。
 *
 * 输入为空 → 返空 Map(避免无意义的并发请求)。
 */
export async function fetchAllRepoUsageServer(
  repos: RepoRegistryEntry[],
): Promise<Map<string, RepoUsageResponse>> {
  if (repos.length === 0) return new Map()
  const out = new Map<string, RepoUsageResponse>()
  const settled = await Promise.allSettled(
    repos.map((r) => fetchRepoUsageServer(r.name)),
  )
  repos.forEach((r, i) => {
    const s = settled[i]
    if (s && s.status === 'fulfilled' && s.value) {
      out.set(r.name, s.value)
    } else if (s && s.status === 'rejected') {
      // 非 404 错:静默降级为 usage=0(列表页不因单仓库失败红屏)
      // eslint-disable-next-line no-console
      console.warn(
        `[fetchAllRepoUsageServer] failed for ${r.name}:`,
        s.reason,
      )
    }
  })
  return out
}
