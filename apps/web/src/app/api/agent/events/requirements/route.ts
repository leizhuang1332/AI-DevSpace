/**
 * 全局需求事件 SSE 透传(ticket 07b 决策 D2)
 *
 * 客户端(同源):GET /api/agent/events/requirements
 *   → Next.js API Route 透传到 agent:GET http://localhost:7777/api/events/requirements
 *   → 把 agent SSE 流用 ReadableStream 透传给 web 客户端
 *
 * 鉴权:从 web origin cookie 读 aidevspace_token,塞 Cookie header 给 agent
 *   (agent authPlugin 校验通过后允许 SseHub.subscribe)
 *
 * 实现要点:
 * - 用 ReadableStream + fetch streaming response 透传(不是 buffer)
 * - 转发 req.signal 到 upstream fetch,客户端断开 → 关 upstream(spec L457 abort 要求)
 * - agent cookie 名 = 'aidevspace_token'(见 apps/agent/src/auth/authPlugin.ts:26)
 */

import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

export const dynamic = 'force-dynamic' // 必须 streaming response

export async function GET(req: NextRequest): Promise<Response> {
  const token = cookies().get('aidevspace_token')?.value
  if (!token) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${AGENT_BASE}/api/events/requirements`, {
      headers: { Cookie: `aidevspace_token=${token}` },
      cache: 'no-store',
      // 客户端断开 → 关 upstream fetch
      signal: req.signal,
    })
  } catch {
    return new Response(JSON.stringify({ error: 'upstream_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: 'upstream_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      // 注:`connection` 是 per-hop header,HTTP/1.1 响应里禁止显式设置(RFC 7230 §6.1);
      // Node 会忽略,这里不写,避免误导。
      'x-accel-buffering': 'no',
    },
  })
}