import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listRequirements, ListRequirementsError } from '../requirement-list'
import { agentFetch, AgentError } from '../agent-client'

// agentFetch mock —— 返回受 vi.mock 控制的结果
vi.mock('../agent-client', async () => {
  const actual = await vi.importActual<typeof import('../agent-client')>('../agent-client')
  return {
    ...actual,
    agentFetch: vi.fn(),
  }
})

const mockFetch = vi.mocked(agentFetch)

const VALID_REQ = {
  id: 'req-001-test',
  title: '退款功能优化',
  status: 'drafting',
  progress: 0,
  repos: ['refund-service'],
  createdAt: '2026-07-15T10:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
}

describe('listRequirements', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('200 成功 → 返回数组(元素字段集正确)', async () => {
    mockFetch.mockResolvedValueOnce({ requirements: [VALID_REQ] })

    const result = await listRequirements()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(VALID_REQ)
    expect(mockFetch).toHaveBeenCalledWith('/api/requirements', {
      method: 'GET',
      signal: undefined,
    })
  })

  it('空列表 → 返回空数组', async () => {
    mockFetch.mockResolvedValueOnce({ requirements: [] })

    const result = await listRequirements()
    expect(result).toEqual([])
  })

  it('401 → 抛 ListRequirementsError(status=401, code=E_AUTH)', async () => {
    mockFetch.mockRejectedValue(
      new AgentError(401, { error: 'E_AUTH', message: 'no auth cookie' }),
    )

    await expect(listRequirements()).rejects.toThrow(ListRequirementsError)
    await expect(listRequirements()).rejects.toMatchObject({
      status: 401,
      code: 'E_AUTH',
    })
  })

  it('503 → 抛 ListRequirementsError(status=503, code=service_not_ready)', async () => {
    mockFetch.mockRejectedValue(
      new AgentError(503, { error: 'service_not_ready' }),
    )

    await expect(listRequirements()).rejects.toMatchObject({
      status: 503,
      code: 'service_not_ready',
    })
  })

  it('后端响应字段缺失 → 抛 ZodError', async () => {
    mockFetch.mockResolvedValue(
      { requirements: [{ id: 'no-title-no-status' }] }, // 缺 title/status/progress 等
    )

    // ZodError 的 instanceof 在 vi.mock 后可能不一致,改用 message 断言
    await expect(listRequirements()).rejects.toThrow(/Required|invalid_type|regex/)
  })

  it('opts.signal 透传给 agentFetch', async () => {
    mockFetch.mockResolvedValueOnce({ requirements: [] })

    const ctrl = new AbortController()
    await listRequirements({ signal: ctrl.signal })
    expect(mockFetch).toHaveBeenCalledWith('/api/requirements', {
      method: 'GET',
      signal: ctrl.signal,
    })
  })
})