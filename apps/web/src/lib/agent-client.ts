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
  // 仅在有 body 时设置 Content-Type，避免 GET / 空 body 请求携带 body 头
  if (init?.body != null && headers['Content-Type'] == null) {
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
  return (await res.json()) as T
}
