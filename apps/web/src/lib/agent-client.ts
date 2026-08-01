import { getOrBootstrap, hasAuthCookie } from './agent-bootstrap'

function getAgentBase(): string {
  return process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:7777'
}

export class AgentError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Agent ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.name = 'AgentError'
  }
}

export async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // 鉴权 bootstrap：缺 cookie 时先拿 token + 写 cookie，后续 fetch 自动带过去。
  // 已 bootstrap 过（同 session 再次访问）→ hasAuthCookie() true，跳过。
  if (!hasAuthCookie()) {
    await getOrBootstrap()
  }

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  }
  // 仅在有 body 时设置 Content-Type，避免 GET / 空 body 请求携带 body 头。
  // 判断必须大小写不敏感：JS 对象 key 大小写敏感，调用方若传了小写
  // 'content-type'，这里再写一个 'Content-Type' 会让两个 key 并存 →
  // fetch 的 Headers fill 走 append 语义合并成 "application/json, application/json"
  // → Fastify 匹配不到 content-type parser → 415 FST_ERR_CTP_INVALID_MEDIA_TYPE。
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
  if (init?.body != null && !hasContentType) {
    headers['Content-Type'] = 'application/json'
  }
  // credentials: include 让浏览器把 localhost:3333 上的 cookie 跨端口发到 localhost:7777
  const res = await fetch(`${getAgentBase()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new AgentError(res.status, body)
  }
  // 204 No Content / 205 Reset Content 没有 body → 不要尝试 res.json()(会抛
  // SyntaxError,jsdom 与真实浏览器均如此)。调用方按需把响应类型声明为 void。
  if (res.status === 204 || res.status === 205) {
    return undefined as T
  }
  return (await res.json()) as T
}
