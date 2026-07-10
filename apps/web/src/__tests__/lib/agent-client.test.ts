import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { agentFetch, AgentError } from '@/lib/agent-client'

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('slice 15: agentFetch', () => {
  it('GET 请求成功返回 JSON（不带 Content-Type）', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const r = await agentFetch<{ ok: boolean }>('/api/health')
    expect(r).toEqual({ ok: true })
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('http://localhost:7777/api/health')
    expect(call[1].headers['Content-Type']).toBeUndefined()
  })

  it('POST/带 body 时设 Content-Type', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    )
    await agentFetch('/api/workspace/config', { method: 'PATCH', body: '{}' })
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers['Content-Type']).toBe('application/json')
  })

  it('非 2xx 抛 AgentError 含 status + body', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_patch', details: ['x'] }), {
        status: 400,
      }),
    )
    await expect(agentFetch('/api/workspace/config', { method: 'PATCH' })).rejects.toBeInstanceOf(
      AgentError,
    )
    // 第二次调用：复用 mock 时 Response body 已被消费；重新挂一个独立的 mock
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_patch', details: ['x'] }), {
        status: 400,
      }),
    )
    try {
      await agentFetch('/api/workspace/config', { method: 'PATCH' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError)
      expect((err as AgentError).status).toBe(400)
      expect((err as AgentError).body).toEqual({
        error: 'invalid_patch',
        details: ['x'],
      })
    }
  })

  it('错误响应 body 非 JSON 时 AgentError.body 为 null', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('not json', { status: 500 }),
    )
    await expect(agentFetch('/x')).rejects.toMatchObject({
      status: 500,
      body: null,
    })
  })

  it('PATCH 请求携带 JSON body', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    )
    await agentFetch('/api/workspace/config', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
    })
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].method).toBe('PATCH')
    expect(call[1].body).toBe('{"theme":"dark"}')
  })

  it('NEXT_PUBLIC_AGENT_URL 覆盖默认 base', async () => {
    process.env.NEXT_PUBLIC_AGENT_URL = 'http://custom:9999'
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    )
    await agentFetch('/api/health')
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'http://custom:9999/api/health',
    )
    delete process.env.NEXT_PUBLIC_AGENT_URL
  })
})
