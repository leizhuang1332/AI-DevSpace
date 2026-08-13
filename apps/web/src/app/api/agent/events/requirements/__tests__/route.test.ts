import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock server-agent-token —— 不再依赖 next/headers 的 cookies(),server-to-server
// 走 x-aidevspace-token header(详见 server-agent-token.ts)
vi.mock('@/lib/server-agent-token', () => ({
  getServerAgentToken: vi.fn(),
}))

import { getServerAgentToken } from '@/lib/server-agent-token'
import { GET } from '../route'

const mockGetToken = vi.mocked(getServerAgentToken)
const mockFetch = vi.fn()

function mockToken(value: string | null) {
  mockGetToken.mockReturnValue(value)
}

describe('GET /api/agent/events/requirements', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockGetToken.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('无 token → 401 unauthorized', async () => {
    mockToken(null)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('200 + text/event-stream content type', async () => {
    mockToken('test-token')
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: hello\ndata: {}\n\n'))
        controller.close()
      },
    })
    mockFetch.mockResolvedValue({
      ok: true,
      body: fakeStream,
    } as unknown as Response)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-cache')
    expect(res.headers.get('connection')).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7777/api/events/requirements',
      expect.objectContaining({
        headers: { 'x-aidevspace-token': 'test-token' },
        cache: 'no-store',
      }),
    )

    // 验证流内容被透传(读 body)
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toBe('event: hello\ndata: {}\n\n')
  })

  it('upstream fetch 抛错 → 502 upstream_failed', async () => {
    mockToken('test-token')
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({ error: 'upstream_failed' })
  })

  it('upstream 非 2xx → 502 upstream_failed', async () => {
    mockToken('test-token')
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
    } as unknown as Response)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
  })

  it('upstream 缺 body → 502 upstream_failed', async () => {
    mockToken('test-token')
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
    } as unknown as Response)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
  })

  it('转发 req.signal 到 upstream fetch(client 断开 → 关 upstream)', async () => {
    mockToken('test-token')
    const ctrl = new AbortController()
    mockFetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start(c) { c.close() } }),
    } as unknown as Response)

    await GET({ signal: ctrl.signal } as unknown as Parameters<typeof GET>[0])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })
})