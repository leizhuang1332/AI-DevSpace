import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock server-agent-token —— 不再依赖 next/headers cookies(),走 x-aidevspace-token header
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

function callGET(id: string, filename: string, signal?: AbortSignal) {
  return GET(
    { signal } as unknown as Parameters<typeof GET>[0],
    { params: { id, filename } },
  )
}

/** 构造带 headers 的 upstream mock Response */
function upstreamResponse(opts: {
  status?: number
  headers?: Record<string, string>
  bodyText?: string
}): Response {
  const { status = 200, headers = {}, bodyText = '' } = opts
  const h = new Headers(headers)
  const body = new ReadableStream({
    start(controller) {
      if (bodyText) controller.enqueue(new TextEncoder().encode(bodyText))
      controller.close()
    },
  })
  return { ok: status < 400, status, headers: h, body } as unknown as Response
}

describe('GET /api/requirement/[id]/assets/[filename]', () => {
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

    const res = await callGET('req-001', 'refund-flow.png')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('200 透传:content-type / content-length / cache-control 跟随 upstream', async () => {
    mockToken('test-token')
    mockFetch.mockResolvedValue(
      upstreamResponse({
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '4',
          'cache-control': 'private, max-age=60',
          // per-hop / 不该透传的头
          connection: 'keep-alive',
        },
        bodyText: 'PNG!',
      }),
    )

    const res = await callGET('req-001', 'refund-flow.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe('4')
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
    expect(res.headers.get('connection')).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7777/api/requirement/req-001/assets/refund-flow.png',
      expect.objectContaining({
        headers: { 'x-aidevspace-token': 'test-token' },
        cache: 'no-store',
      }),
    )

    const reader = res.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toBe('PNG!')
  })

  it('id / filename 做 URL encode(防路径注入)', async () => {
    mockToken('test-token')
    mockFetch.mockResolvedValue(upstreamResponse({ status: 200 }))

    await callGET('req/x', 'a b.png')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7777/api/requirement/req%2Fx/assets/a%20b.png',
      expect.anything(),
    )
  })

  it('upstream 404 → 原样透传 status(不折叠成 502)', async () => {
    mockToken('test-token')
    mockFetch.mockResolvedValue(
      upstreamResponse({
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyText: '{"error":"E_ASSET_NOT_FOUND"}',
      }),
    )

    const res = await callGET('req-001', 'missing.png')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'E_ASSET_NOT_FOUND' })
  })

  it('upstream fetch 抛错 → 502 upstream_failed', async () => {
    mockToken('test-token')
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const res = await callGET('req-001', 'refund-flow.png')
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({ error: 'upstream_failed' })
  })

  it('转发 req.signal 到 upstream fetch', async () => {
    mockToken('test-token')
    const ctrl = new AbortController()
    mockFetch.mockResolvedValue(upstreamResponse({ status: 200 }))

    await callGET('req-001', 'refund-flow.png', ctrl.signal)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })
})
