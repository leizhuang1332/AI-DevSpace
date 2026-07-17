import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock next/headers — 不引入真实 Next.js 运行时
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

import { cookies } from 'next/headers'
import { GET } from '../route'

const mockCookies = vi.mocked(cookies)
const mockFetch = vi.fn()

function mockCookiePresent(token: string | undefined) {
  mockCookies.mockReturnValue({
    get: (name: string) =>
      name === 'aidevspace_token' ? (token ? { name, value: token } : undefined) : undefined,
  } as unknown as ReturnType<typeof cookies>)
}

describe('GET /api/agent/events/requirements', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockCookies.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('无 token → 401 unauthorized', async () => {
    mockCookiePresent(undefined)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('200 + text/event-stream content type', async () => {
    mockCookiePresent('test-token')
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
        headers: { Cookie: 'aidevspace_token=test-token' },
        cache: 'no-store',
      }),
    )

    // 验证流内容被透传(读 body)
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toBe('event: hello\ndata: {}\n\n')
  })

  it('upstream fetch 抛错 → 502 upstream_failed', async () => {
    mockCookiePresent('test-token')
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({ error: 'upstream_failed' })
  })

  it('upstream 非 2xx → 502 upstream_failed', async () => {
    mockCookiePresent('test-token')
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
    } as unknown as Response)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
  })

  it('upstream 缺 body → 502 upstream_failed', async () => {
    mockCookiePresent('test-token')
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
    } as unknown as Response)

    const res = await GET({ signal: undefined } as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
  })

  it('转发 req.signal 到 upstream fetch(client 断开 → 关 upstream)', async () => {
    mockCookiePresent('test-token')
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