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
  const headers: Record<string, string> = {
    // Token 字段留 TODO；issue 03 接入后注入
    ...(init?.headers as Record<string, string> | undefined),
  }
  // 仅在有 body 时设置 Content-Type，避免 GET / 空 body 请求携带 body 头
  if (init?.body != null && headers['Content-Type'] == null) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${getAgentBase()}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new AgentError(res.status, body)
  }
  return (await res.json()) as T
}
