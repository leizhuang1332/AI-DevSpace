/**
 * 需求列表 server-side fetch(RSC 专用)
 *
 * ticket 07b 决策 D1:RSC 内不走 agentFetch(无 document,无法 bootstrap),
 * 而是直接 fetch agent server + 手动传授权头(从 server-agent-token helper 读)。
 *
 * 鉴权来源:server-agent-token.getServerAgentToken()
 *   1. cookie `aidevspace_token`(外部 HTTP caller / e2e set cookie)
 *   2. AIDEVSPACE_HOME/.agent-token 文件(首次 RSC 渲染,server-to-server 共享;
 *      解决"鸡生蛋"问题 —— RSC 渲染先于 client bootstrap,cookie 还没写入)
 *
 * 注意:
 * - 本文件仅 server-side 使用(client component import 会触发 webpack UnhandledSchemeError)
 * - 用 `cache: 'no-store'` 防 RSC 永久缓存
 *
 * 调用方:RSC `(workspace)/layout.tsx` / `(workspace)/page.tsx` / `(workspace)/requirements/page.tsx`
 */

import {
  RequirementListResponseSchema,
  type RequirementSummary,
} from '@ai-devspace/shared'
import { getServerAgentToken } from './server-agent-token'

const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

export class ServerListRequirementsError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`ServerListRequirements ${status}: ${JSON.stringify(body)}`)
    this.name = 'ServerListRequirementsError'
  }
}

/** RSC 内拉取需求列表(无入参,后端返全量) */
export async function fetchRequirementsServer(): Promise<RequirementSummary[]> {
  const token = getServerAgentToken()
  if (!token) {
    throw new ServerListRequirementsError(401, { error: 'no_auth' })
  }

  const res = await fetch(`${AGENT_BASE}/api/requirements`, {
    headers: { 'x-aidevspace-token': token },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ServerListRequirementsError(res.status, body)
  }

  const raw = await res.json()
  return RequirementListResponseSchema.parse(raw).requirements
}