/**
 * requirement 级 SSE 透传(修复 :3333 直连 404 —— 沿用 ticket 07b 决策 D2 的透传模式)
 *
 * 客户端(同源):GET /api/requirement/:id/events
 *   → Next.js API Route 透传到 agent:GET http://localhost:7777/api/requirement/:id/events
 *   → 把 agent SSE 流用 ReadableStream 透传给 web 客户端
 *
 * 背景:analyzing-zone.tsx / statusbar.tsx 用相对路径 EventSource 订阅本端点,
 * 而真正的路由注册在 agent(apps/agent/src/sse/requirementEventsRoute.ts)。
 * EventSource 默认不带跨域 cookie,所以与全局事件流
 * (app/api/agent/events/requirements/route.ts)对称地走同源透传。
 *
 * 鉴权:从 server-agent-token helper 拿 token,塞 `x-aidevspace-token` header 给 agent
 *   (agent authPlugin 校验通过后允许 SseHub.subscribe,ticket 07b RSC 修复同款)
 *
 * 实现要点:
 * - 用 ReadableStream + fetch streaming response 透传(不是 buffer)
 * - 转发 req.signal 到 upstream fetch,客户端断开 → 关 upstream
 * - token 来自 server-agent-token(cookie 优先,fallback ~/.aidevspace/.agent-token)
 */

import type { NextRequest } from 'next/server'
import { getServerAgentToken } from '@/lib/server-agent-token'

const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

export const dynamic = 'force-dynamic' // 必须 streaming response

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
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
      `${AGENT_BASE}/api/requirement/${encodeURIComponent(params.id)}/events`,
      {
        headers: { 'x-aidevspace-token': token },
        cache: 'no-store',
        // 客户端断开 → 关 upstream fetch
        signal: req.signal,
      },
    )
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
