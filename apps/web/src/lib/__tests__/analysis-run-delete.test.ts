/**
 * Analysis Run 永久删除客户端 wrapper 测试(issue 05 · ADR-0021)
 *
 * 覆盖验收点:
 * - DELETE 失败 → DeleteAnalysisRunError 携带 status + code
 * - DELETE 成功(204)→ 不抛错
 * - canDeleteAnalysisRun 工具函数:r running → false;succeeded / failed → true
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// mock agent-bootstrap 在顶层(vitest hoists vi.mock);这能让 agent-client
// 走 hasAuthCookie=true 跳过 bootstrap。
vi.mock('../agent-bootstrap', () => ({
  hasAuthCookie: () => true,
  getOrBootstrap: async () => ({
    ok: true,
    token: 'mock-token',
    cookieName: 'aidevspace_token',
    cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 30 * 24 * 3600 },
    apiBase: 'http://localhost:7777',
    agentVersion: 'test',
    sseNote: '',
  }),
  resetBootstrapCache: () => {},
}))

import {
  deleteAnalysisRun,
  canDeleteAnalysisRun,
  DeleteAnalysisRunError,
} from '../analysis-run-delete'

// ============================================================================
// fetch mock
// ============================================================================

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// deleteAnalysisRun
// ============================================================================

describe('deleteAnalysisRun · 客户端 wrapper(issue 05)', () => {
  it('204 No Content → 不抛错', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('no body')
      },
    })
    // 不应抛错
    await expect(deleteAnalysisRun('req-1', 'run-a')).resolves.toBeUndefined()
  })

  it('404 analysis_run_not_found → DeleteAnalysisRunError.code = "analysis_run_not_found"', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'analysis_run_not_found', reason: 'gone' }),
    })
    await expect(deleteAnalysisRun('req-1', 'run-a')).rejects.toMatchObject({
      status: 404,
      code: 'analysis_run_not_found',
    })
  })

  it('409 analysis_run_still_running → code = "analysis_run_still_running"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'analysis_run_still_running',
        reason: 'cannot delete running run',
      }),
    })
    await expect(deleteAnalysisRun('req-1', 'run-running')).rejects.toMatchObject({
      status: 409,
      code: 'analysis_run_still_running',
    })
  })

  it('500 analysis_run_delete_failed → code = "analysis_run_delete_failed"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'analysis_run_delete_failed', reason: 'fs error' }),
    })
    await expect(deleteAnalysisRun('req-1', 'run-a')).rejects.toMatchObject({
      status: 500,
      code: 'analysis_run_delete_failed',
    })
  })

  it('服务端返未知 error code → DeleteAnalysisRunError.code 是 undefined', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'unknown_thing' }),
    })
    try {
      await deleteAnalysisRun('req-1', 'run-a')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteAnalysisRunError)
      expect((err as DeleteAnalysisRunError).code).toBeUndefined()
    }
  })
})

// ============================================================================
// canDeleteAnalysisRun
// ============================================================================

describe('canDeleteAnalysisRun · 前端门禁(issue 05 验收 8)', () => {
  it('running → false', () => {
    expect(canDeleteAnalysisRun({ status: 'running' })).toBe(false)
  })
  it('succeeded → true', () => {
    expect(canDeleteAnalysisRun({ status: 'succeeded' })).toBe(true)
  })
  it('failed → true', () => {
    expect(canDeleteAnalysisRun({ status: 'failed' })).toBe(true)
  })
})