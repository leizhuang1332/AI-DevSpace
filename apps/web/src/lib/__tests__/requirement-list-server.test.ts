import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock next/headers — 不引入真实 Next.js 运行时
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

import { cookies } from 'next/headers'
import { fetchRequirementsServer, ServerListRequirementsError } from '../requirement-list.server'

const mockCookies = vi.mocked(cookies)
const mockFetch = vi.fn()

const VALID_REQ = {
  id: 'req-001-test',
  title: '退款功能优化',
  status: 'drafting',
  progress: 0,
  repos: ['refund-service'],
  createdAt: '2026-07-15T10:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
}

function mockCookiePresent(token: string | undefined) {
  mockCookies.mockReturnValue({
    get: (name: string) =>
      name === 'aidevspace_token' ? (token ? { name, value: token } : undefined) : undefined,
  } as unknown as ReturnType<typeof cookies>)
}

describe('fetchRequirementsServer', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockCookies.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('无 token → 抛 ServerListRequirementsError(401, no_auth_cookie)', async () => {
    mockCookiePresent(undefined)

    await expect(fetchRequirementsServer()).rejects.toMatchObject({
      status: 401,
      body: { error: 'no_auth_cookie' },
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('200 成功 → 返回数组', async () => {
    mockCookiePresent('test-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requirements: [VALID_REQ] }),
    })

    const result = await fetchRequirementsServer()
    expect(result).toEqual([VALID_REQ])
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7777/api/requirements',
      expect.objectContaining({
        headers: { Cookie: 'aidevspace_token=test-token' },
        cache: 'no-store',
      }),
    )
  })

  it('500 → 抛 ServerListRequirementsError(500, body)', async () => {
    mockCookiePresent('test-token')
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'E_INTERNAL' }),
    })

    await expect(fetchRequirementsServer()).rejects.toBeInstanceOf(ServerListRequirementsError)
    await expect(fetchRequirementsServer()).rejects.toMatchObject({
      status: 500,
      body: { error: 'E_INTERNAL' },
    })
  })

  it('响应 body 非法 → 抛 ZodError', async () => {
    mockCookiePresent('test-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requirements: [{ id: 'oops' }] }),
    })

    // ZodError instanceof 在 vi.mock 后可能不一致,改用 message 断言
    await expect(fetchRequirementsServer()).rejects.toThrow(/Required|invalid_type|regex/)
  })

  it('AGENT_URL 环境变量覆盖默认 base', async () => {
    // AGENT_URL 在模块加载时被 read —— 必须先 vi.resetModules + 重新 import
    const prev = process.env.AGENT_URL
    process.env.AGENT_URL = 'http://agent-internal:9999'
    vi.resetModules()

    vi.doMock('next/headers', () => ({
      cookies: vi.fn(() => ({
        get: (name: string) =>
          name === 'aidevspace_token' ? { name, value: 'test-token' } : undefined,
      })),
    }))

    const mod = await import('../requirement-list.server')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requirements: [] }),
    })

    await mod.fetchRequirementsServer()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://agent-internal:9999/api/requirements',
      expect.any(Object),
    )

    if (prev === undefined) delete process.env.AGENT_URL
    else process.env.AGENT_URL = prev
    vi.doUnmock('next/headers')
    vi.resetModules()
  })
})