/**
 * 前端 agent 鉴权 bootstrap。
 *
 * 设计契约（apps/agent/src/routes/bootstrap.ts）：
 *   GET /api/agent/bootstrap 是 public 路由，返回
 *     { token, cookieName: 'aidevspace_token',
 *       cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 2_592_000 },
 *       apiBase, agentVersion, sseNote }
 *
 * 跨端口原因（3333 web → 7777 agent 是 cross-origin），agent 不能直接 Set-Cookie
 * （跨端口 Set-Cookie 在 localhost http dev 下被浏览器拒）。所以由前端从
 * bootstrap 响应里取 token，再用 document.cookie 写到当前 page origin —— cookie
 * 按 hostname 共享（不按端口），所以 3333 写、7777 也能收到。
 *
 * SSE（EventSource 不能带自定义 header）后续会复用同一条 cookie（bootstrap 响应
 * 的 sseNote 字段已说明）。
 */

function getAgentBase(): string {
  return process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:7777'
}

export interface BootstrapResponse {
  ok: true
  token: string
  cookieName: string
  cookieAttributes: {
    SameSite: 'Strict'
    Path: '/'
    MaxAge: number
  }
  apiBase: string
  agentVersion: string
  sseNote: string
}

const COOKIE_NAME = 'aidevspace_token'

// 单飞：同一帧内多个并发 agentFetch 共享同一个 bootstrap promise
let bootstrapPromise: Promise<BootstrapResponse> | null = null

export async function getOrBootstrap(): Promise<BootstrapResponse> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = doBootstrap().catch((err) => {
    // 失败时清缓存，下次调用重新尝试（避免一次失败永久卡死）
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

async function doBootstrap(): Promise<BootstrapResponse> {
  const url = `${getAgentBase()}/api/agent/bootstrap`
  // bootstrap 本身就是 public，不能走 agentFetch（agentFetch 会反过来调 bootstrap）
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    throw new Error(`bootstrap failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as BootstrapResponse
  if (!body.ok || typeof body.token !== 'string') {
    throw new Error('bootstrap response malformed')
  }
  writeCookie(body.cookieName || COOKIE_NAME, body.token, body.cookieAttributes)
  return body
}

function writeCookie(
  name: string,
  value: string,
  attrs: BootstrapResponse['cookieAttributes'],
): void {
  if (typeof document === 'undefined') return // SSR 安全
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  ]
  if (attrs.Path) parts.push(`Path=${attrs.Path}`)
  if (typeof attrs.MaxAge === 'number') parts.push(`Max-Age=${attrs.MaxAge}`)
  if (attrs.SameSite) parts.push(`SameSite=${attrs.SameSite}`)
  document.cookie = parts.join('; ')
}

/**
 * 当前 origin 是否已经有 aidevspace_token cookie。
 * - 浏览器：解析 document.cookie
 * - SSR (document 不存在)：保守返回 true，让请求直接 401（避免在服务端跑 bootstrap）
 */
export function hasAuthCookie(): boolean {
  if (typeof document === 'undefined') return true
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${COOKIE_NAME}=`))
}

/** 测试辅助：清掉单飞缓存，让下一次 getOrBootstrap 真的去打网络 */
export function resetBootstrapCache(): void {
  bootstrapPromise = null
}