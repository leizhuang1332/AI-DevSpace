/**
 * 需求列表 server-side fetch(RSC 专用)
 *
 * ticket 07b 决策 D1:RSC 内不走 agentFetch(无 document,无法 bootstrap),
 * 而是直接 fetch agent server + 手动传 Cookie header(从 cookies() helper 读)。
 *
 * 注意:
 * - 本文件仅 server-side 使用(client component import 会触发 webpack UnhandledSchemeError)
 * - 用 `cache: 'no-store'` 防 RSC 永久缓存
 *
 * 调用方:RSC `(workspace)/layout.tsx` / `(workspace)/page.tsx` / `(workspace)/requirements/page.tsx`
 */

import { cookies } from 'next/headers'
import {
  RequirementListResponseSchema,
  type RequirementSummary,
} from '@ai-devspace/shared'

const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

export class ServerListRequirementsError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`ServerListRequirements ${status}: ${JSON.stringify(body)}`)
    this.name = 'ServerListRequirementsError'
  }
}

/** RSC 内拉取需求列表(无入参,后端返全量) */
export async function fetchRequirementsServer(): Promise<RequirementSummary[]> {
  const token = cookies().get('aidevspace_token')?.value
  if (!token) {
    throw new ServerListRequirementsError(401, { error: 'no_auth_cookie' })
  }

  const res = await fetch(`${AGENT_BASE}/api/requirements`, {
    headers: { Cookie: `aidevspace_token=${token}` },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ServerListRequirementsError(res.status, body)
  }

  const raw = await res.json()
  return RequirementListResponseSchema.parse(raw).requirements
}