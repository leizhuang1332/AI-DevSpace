/**
 * useAnalysisResponse 自动保存 hook tests(issue 04 · ADR-0021)
 *
 * 覆盖验收点:
 * - 4:输入中 → dirty;saving / saved / error 状态机
 * - 5:debounce 防抖(>= 600ms 才提交)
 * - 6:flush() 立即提交当前 draft(模拟失焦 / 历史切换 / 开始分析)
 * - 7:stale_response → 等待最新 edit_version,自动重试一次
 *
 * 不测实现细节(决策 15):不锁内部 reducer / map / ref,
 * 只断言可观察的状态 + 触发的 HTTP 调用。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAnalysisResponse } from '@/hooks/use-analysis-response'
import {
  fetchIssueResponse,
  putIssueResponse,
  StaleResponseError,
} from '@/lib/analysis-response'

vi.mock('@/lib/analysis-response', async () => {
  const actual = await vi.importActual<typeof import('@/lib/analysis-response')>(
    '@/lib/analysis-response',
  )
  return {
    ...actual,
    fetchIssueResponse: vi.fn(),
    putIssueResponse: vi.fn(),
  }
})

const mockedFetch = fetchIssueResponse as unknown as ReturnType<typeof vi.fn>
const mockedPut = putIssueResponse as unknown as ReturnType<typeof vi.fn>

const DEFAULT_REQ = 'req-1'
const DEFAULT_RUN = 'run-1'
const DEFAULT_ISSUE = 'iss-1'

const emptyResp = {
  issue_id: DEFAULT_ISSUE,
  run_id: DEFAULT_RUN,
  body: '',
  created_at: '',
  updated_at: '',
  edit_version: 0,
  answered: false,
}

beforeEach(() => {
  mockedFetch.mockReset()
  mockedPut.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAnalysisResponse · 初始装载', () => {
  it('mount 时拉一次 fetch → draft = 已有 body', async () => {
    mockedFetch.mockResolvedValueOnce({
      ...emptyResp,
      body: '已有答复',
      edit_version: 1,
      answered: true,
    })

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 50),
    )

    await waitFor(() => {
      expect(result.current.draft).toBe('已有答复')
    })
    expect(result.current.editVersion).toBe(1)
    expect(result.current.status).toBe('idle')
  })

  it('fetch 失败 → status=error', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'))

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 50),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.errorMessage).toContain('network down')
  })
})

describe('useAnalysisResponse · debounce', () => {
  it('输入后 < debounceMs 不触发 PUT', async () => {
    mockedFetch.mockResolvedValueOnce({ ...emptyResp })
    mockedPut.mockResolvedValue({
      ...emptyResp,
      edit_version: 1,
      answered: true,
    })

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 600),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('idle')
    })

    act(() => {
      result.current.setDraft('新内容')
    })
    expect(mockedPut).not.toHaveBeenCalled()
    expect(result.current.status).toBe('dirty')
  })

  it('输入后 ≥ debounceMs 自动 flush', async () => {
    mockedFetch.mockResolvedValueOnce({ ...emptyResp })
    mockedPut.mockResolvedValue({
      ...emptyResp,
      edit_version: 1,
      answered: true,
    })

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 80),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('idle')
    })

    act(() => {
      result.current.setDraft('第一版')
    })
    // wait for debounce + flush promise
    await waitFor(() => {
      expect(mockedPut).toHaveBeenCalledTimes(1)
    })
    // putIssueResponse(req, run, issue, body, base) → body at index 3
    expect(mockedPut.mock.calls[0]?.[3]).toBe('第一版')
  })
})

describe('useAnalysisResponse · flush gate', () => {
  it('flush() 强制提交当前 draft(不等 debounce)', async () => {
    mockedFetch.mockResolvedValueOnce({ ...emptyResp })
    mockedPut.mockResolvedValue({
      ...emptyResp,
      edit_version: 1,
      answered: true,
    })

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 60_000),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('idle')
    })

    act(() => {
      result.current.setDraft('立刻提交')
    })
    expect(mockedPut).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.flush()
    })

    expect(mockedPut).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saved')
  })

  it('flush() + debounce 同时到达时仅提交一次', async () => {
    const putCalls: string[] = []
    mockedFetch.mockResolvedValueOnce({ ...emptyResp })
    mockedPut.mockImplementation(async (req, run, issueId, body, _base) => {
      putCalls.push(body)
      return {
        ...emptyResp,
        edit_version: 1,
        answered: true,
      }
    })

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 50),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('idle')
    })

    act(() => {
      result.current.setDraft('第一次')
    })

    // 显式 flush()(模拟"开始分析")→ debounce timer 已被 performFlush 清掉,
    // 后续 setTimeout 不会再触发
    await act(async () => {
      await result.current.flush()
    })

    // 再等 100ms,确认 debounce 不会再补一次 PUT
    await new Promise((r) => setTimeout(r, 100))

    expect(putCalls).toHaveLength(1)
    expect(putCalls[0]).toBe('第一次')
  })
})

describe('useAnalysisResponse · stale_response 自动重试', () => {
  it('服务端 409 stale_response → 用最新 edit_version 再 PUT', async () => {
    mockedFetch.mockResolvedValueOnce({ ...emptyResp })
    mockedPut
      .mockRejectedValueOnce(new StaleResponseError(5, '2026-08-01T00:05:00Z'))
      .mockResolvedValueOnce({
        ...emptyResp,
        edit_version: 6,
        answered: true,
      })

    const { result } = renderHook(() =>
      useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, DEFAULT_ISSUE, 60_000),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('idle')
    })

    act(() => {
      result.current.setDraft('我后来才写的内容')
    })

    await act(async () => {
      await result.current.flush()
    })

    expect(mockedPut).toHaveBeenCalledTimes(2)
    // 第二次用服务端返回的最新 base=5(putIssueResponse(req, run, issue, body, base))
    expect(mockedPut.mock.calls[1]?.[4]).toBe(5)
    expect(result.current.editVersion).toBe(6)
    expect(result.current.status).toBe('saved')
  })
})

describe('useAnalysisResponse · 切换 issue target', () => {
  it('切换 issueId → 重新拉取 + 清空旧 draft', async () => {
    mockedFetch
      .mockResolvedValueOnce({
        ...emptyResp,
        issue_id: 'iss-1',
        body: '旧答复',
        edit_version: 1,
        answered: true,
      })
      .mockResolvedValueOnce({
        ...emptyResp,
        issue_id: 'iss-2',
        body: '新答复',
        edit_version: 2,
        answered: true,
      })

    const { result, rerender } = renderHook(
      ({ issueId }) => useAnalysisResponse(DEFAULT_REQ, DEFAULT_RUN, issueId, 50),
      { initialProps: { issueId: 'iss-1' } },
    )

    await waitFor(() => {
      expect(result.current.draft).toBe('旧答复')
    })

    rerender({ issueId: 'iss-2' })

    await waitFor(() => {
      expect(result.current.draft).toBe('新答复')
    })
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })
})