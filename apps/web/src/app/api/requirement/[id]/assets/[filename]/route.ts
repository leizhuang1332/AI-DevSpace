/**
 * requirement 资产(图片)透传(与同级 events/route.ts 同根因的第二个实例)
 *
 * 客户端(同源):GET /api/requirement/:id/assets/:filename
 *   → Next.js API Route 透传到 agent:
 *     GET http://localhost:7777/api/requirement/:id/assets/:filename
 *
 * 背景:analyzing.server.ts 生成的 asset url 是同源相对路径(直接用作 <img src>),
 * 而真正的路由注册在 agent(apps/agent/src/routes/requirement.ts)。
 *
 * 鉴权:从 server-agent-token helper 拿 token,塞 `x-aidevspace-token` header 给 agent
 *   (cookie 优先,fallback ~/.aidevspace/.agent-token —— 详见 server-agent-token.ts)
 *
 * 实现要点:
 * - 二进制流式透传(不 buffer);content-type / content-length / cache-control
 *   原样跟随 upstream(agent 侧由 extensionToImageMime 派生)
 * - 非 2xx(404 E_ASSET_NOT_FOUND / 401 / 503)原样透传 status + body,
 *   不折叠成 502 —— 调用方(<img> / fetcher)需要区分"资源不存在"
 * - 仅网络层失败(agent 不可达)才 502 upstream_failed
 */

import type { NextRequest } from 'next/server'
import { getServerAgentToken } from '@/lib/server-agent-token'

const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

export const dynamic = 'force-dynamic'

/** 透传给客户端的响应头白名单(per-hop header 不转发) */
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'cache-control'] as const

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; filename: string } },
): Promise<Response> {
  const token = getServerAgentToken()
  if (!token) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  let upstream: Response
  try {
    upstream = await fetch(
      `${AGENT_BASE}/api/requirement/${encodeURIComponent(params.id)}/assets/${encodeURIComponent(params.filename)}`,
      {
        headers: { 'x-aidevspace-token': token },
        cache: 'no-store',
        signal: req.signal,
      },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'upstream_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const headers = new Headers()
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}
