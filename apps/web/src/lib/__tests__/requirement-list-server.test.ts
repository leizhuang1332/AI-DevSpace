import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock server-agent-token —— 测试隔离,防止真实文件 / cookie 干扰
vi.mock('../server-agent-token', () => ({
  getServerAgentToken: vi.fn(),
}))

import { getServerAgentToken } from '../server-agent-token'
import { fetchRequirementsServer, ServerListRequirementsError } from '../requirement-list.server'

const mockGetToken = vi.mocked(getServerAgentToken)
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

describe('fetchRequirementsServer', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockGetToken.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('无 token → 抛 ServerListRequirementsError(401, no_auth)', async () => {
    mockGetToken.mockReturnValue(null)

    await expect(fetchRequirementsServer()).rejects.toMatchObject({
      status: 401,
      body: { error: 'no_auth' },
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('200 成功 → 返回数组(用 x-aidevspace-token header,不再用 Cookie)', async () => {
    mockGetToken.mockReturnValue('test-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requirements: [VALID_REQ] }),
    })

    const result = await fetchRequirementsServer()
    expect(result).toEqual([VALID_REQ])
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7777/api/requirements',
      expect.objectContaining({
        headers: { 'x-aidevspace-token': 'test-token' },
        cache: 'no-store',
      }),
    )
  })

  it('500 → 抛 ServerListRequirementsError(500, body)', async () => {
    mockGetToken.mockReturnValue('test-token')
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
    mockGetToken.mockReturnValue('test-token')
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

    vi.doMock('../server-agent-token', () => ({
      getServerAgentToken: vi.fn(() => 'test-token'),
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
    vi.doUnmock('../server-agent-token')
    vi.resetModules()
  })

  it('token 来自文件 fallback(cookie 为空但 helper 返 token)→ 仍能正确调 agent', async () => {
    // 模拟首次 RSC 渲染:cookie 没有,但 server-agent-token 读到了 ~/.aidevspace/.agent-token
    mockGetToken.mockReturnValue('file-fallback-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requirements: [] }),
    })

    const result = await fetchRequirementsServer()
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7777/api/requirements',
      expect.objectContaining({
        headers: { 'x-aidevspace-token': 'file-fallback-token' },
      }),
    )
  })
})
