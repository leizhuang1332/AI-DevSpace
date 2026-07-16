import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AttachReposError,
  attachReposToRequirement,
  isAttachReposError,
  safeParseAttachReposResponse,
} from '@/lib/repo-attach'

// mock @/lib/agent-client 的 agentFetch,避免真打网络
const mockAgentFetch = vi.fn()
vi.mock('@/lib/agent-client', () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
  AgentError: class AgentError extends Error {
    constructor(public readonly status: number, public readonly body: unknown) {
      super(`Agent ${status}`)
      this.name = 'AgentError'
    }
  },
}))

beforeEach(() => {
  mockAgentFetch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attachReposToRequirement', () => {
  it('200 OK 全成功', async () => {
    mockAgentFetch.mockResolvedValue({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 2,
      failed: 0,
      results: [
        { ok: true, repoId: 'r1', branch: 'feat/test', worktreePath: '/a/r1', base: 'main' },
        { ok: true, repoId: 'r2', branch: 'feat/test', worktreePath: '/a/r2', base: 'master' },
      ],
    })

    const out = await attachReposToRequirement('req-001', {
      repoIds: ['r1', 'r2'],
      branchName: 'feat/test',
    })

    expect(out.succeeded).toBe(2)
    expect(out.failed).toBe(0)
    expect(out.results).toHaveLength(2)

    // 验证 agentFetch 调用参数
    expect(mockAgentFetch).toHaveBeenCalledTimes(1)
    const [path, init] = mockAgentFetch.mock.calls[0]
    expect(path).toBe('/api/requirement/req-001/repos')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      repoIds: ['r1', 'r2'],
      branchName: 'feat/test',
    })
  })

  it('partial success response passes through', async () => {
    mockAgentFetch.mockResolvedValue({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 1,
      failed: 1,
      results: [
        { ok: true, repoId: 'r1', branch: 'feat/test', worktreePath: '/a/r1', base: 'main' },
        { ok: false, repoId: 'r2', code: 'E_DISK_FULL', message: 'No space left' },
      ],
    })
    const out = await attachReposToRequirement('req-001', {
      repoIds: ['r1', 'r2'],
      branchName: 'feat/test',
    })
    expect(out.succeeded).toBe(1)
    expect(out.failed).toBe(1)
  })

  it('AgentError → AttachReposError(保留 status + body)', async () => {
    // mock AgentError 抛出
    const { AgentError } = await import('@/lib/agent-client')
    mockAgentFetch.mockRejectedValue(new AgentError(401, { error: 'unauthorized' }))

    await expect(
      attachReposToRequirement('req-001', {
        repoIds: ['r1'],
        branchName: 'feat/test',
      }),
    ).rejects.toMatchObject({
      name: 'AttachReposError',
      status: 401,
      body: { error: 'unauthorized' },
    })
  })

  it('non-AgentError passthrough(网络错等)', async () => {
    mockAgentFetch.mockRejectedValue(new Error('Network down'))
    await expect(
      attachReposToRequirement('req-001', {
        repoIds: ['r1'],
        branchName: 'feat/test',
      }),
    ).rejects.toThrow(/Network down/)
  })

  it('入参 schema 校验失败:repoIds 为空 → ZodError', async () => {
    await expect(
      attachReposToRequirement('req-001', {
        repoIds: [],
        branchName: 'feat/test',
      }),
    ).rejects.toThrow()
    // 验证根本没调 agentFetch
    expect(mockAgentFetch).not.toHaveBeenCalled()
  })

  it('入参 schema 校验失败:branchName 过长 → ZodError', async () => {
    await expect(
      attachReposToRequirement('req-001', {
        repoIds: ['r1'],
        branchName: 'a'.repeat(101),
      }),
    ).rejects.toThrow()
  })

  it('出参 schema 校验失败:后端契约破了 → ZodError', async () => {
    mockAgentFetch.mockResolvedValue({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 'wrong-type', // 故意类型错
      failed: 0,
      results: [],
    })
    await expect(
      attachReposToRequirement('req-001', {
        repoIds: ['r1'],
        branchName: 'feat/test',
      }),
    ).rejects.toThrow()
  })

  it('encodeURIComponent: id 含特殊字符', async () => {
    mockAgentFetch.mockResolvedValue({
      requirementId: 'req/with/slash',
      branchName: 'feat/test',
      succeeded: 0,
      failed: 0,
      results: [],
    })
    await attachReposToRequirement('req/with/slash', {
      repoIds: ['r1'],
      branchName: 'feat/test',
    })
    expect(mockAgentFetch.mock.calls[0][0]).toBe(
      '/api/requirement/req%2Fwith%2Fslash/repos',
    )
  })

  it('AbortSignal 透传', async () => {
    mockAgentFetch.mockResolvedValue({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 1,
      failed: 0,
      results: [],
    })
    const controller = new AbortController()
    await attachReposToRequirement(
      'req-001',
      { repoIds: ['r1'], branchName: 'feat/test' },
      { signal: controller.signal },
    )
    expect(mockAgentFetch.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe('isAttachReposError', () => {
  it('returns true for AttachReposError', () => {
    const e = new AttachReposError(500, {})
    expect(isAttachReposError(e)).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isAttachReposError(new Error('x'))).toBe(false)
    expect(isAttachReposError('string error')).toBe(false)
    expect(isAttachReposError(null)).toBe(false)
  })
})

describe('safeParseAttachReposResponse', () => {
  it('ok=true for valid payload', () => {
    const r = safeParseAttachReposResponse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 0,
      failed: 0,
      results: [],
    })
    expect(r.ok).toBe(true)
    expect(r.data?.requirementId).toBe('req-001')
  })

  it('ok=false for invalid payload', () => {
    const r = safeParseAttachReposResponse({ foo: 'bar' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeDefined()
  })
})
