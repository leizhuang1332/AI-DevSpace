/**
 * PrdSplitResultBanner 组件测试 — issue 08 / ADR-0027 D4
 *
 * 验收:
 * - status='running' → 显示「拆分中」
 * - status='succeeded' → 显示「建议卡片组 N 条」+ [载入到看板] 按钮
 * - status='failed' → 显示错误
 * - isError → 错误 banner
 * - [载入到看板] → onReview
 * - 关闭 → onDismiss
 *
 * mock:vi.mock board-detail-hooks 的 usePrdSplitRunDetail
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrdSplitResultBanner } from '@/components/board/detail/PrdSplitResultBanner'
import type { PrdSplitRunDetailResponse } from '@ai-devspace/shared'

let mockDetail: PrdSplitRunDetailResponse | null = null
let mockIsError = false

vi.mock('@/lib/board-detail-hooks', () => ({
  usePrdSplitRunDetail: () => ({ detail: mockDetail, isError: mockIsError, isLoading: false }),
}))

afterEach(() => {
  cleanup()
  mockDetail = null
  mockIsError = false
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function makeRun(overrides: Partial<PrdSplitRunDetailResponse['run']> = {}) {
  return {
    run: {
      schema_version: 1 as const,
      run_id: 'prd-1',
      requirement_id: 'req-1',
      status: 'running' as const,
      created_at: '2026-08-07T00:00:00Z',
      finished_at: null,
      error: null,
      granularity: '中' as const,
      expected_count: 5,
      actual_count: 0,
      ...overrides,
    },
    cards: [],
  } as PrdSplitRunDetailResponse
}

describe('PrdSplitResultBanner', () => {
  it('running → 显示拆分中', () => {
    mockDetail = makeRun({ status: 'running' })
    render(
      <PrdSplitResultBanner
        requirementId="req-1"
        runId="prd-1"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    const banner = screen.getByTestId('board-split-result-banner')
    expect(banner).toHaveAttribute('data-status', 'running')
    expect(banner).toHaveTextContent('拆分中')
  })

  it('succeeded → 显示 N 条 + [载入到看板] 按钮', () => {
    mockDetail = makeRun({
      status: 'succeeded',
      finished_at: '2026-08-07T01:00:00Z',
      actual_count: 3,
    })
    mockDetail.cards = [
      { ordinal: 1, tool_use_id: 'a', title: '卡1', content: '', suggested_status: 'backlog', suggested_priority: 'medium', labels: [] },
      { ordinal: 2, tool_use_id: 'b', title: '卡2', content: '', suggested_status: 'backlog', suggested_priority: null, labels: [] },
      { ordinal: 3, tool_use_id: 'c', title: '卡3', content: '', suggested_status: 'backlog', suggested_priority: 'high', labels: [] },
    ]
    render(
      <PrdSplitResultBanner
        requirementId="req-1"
        runId="prd-1"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    const banner = screen.getByTestId('board-split-result-banner')
    expect(banner).toHaveAttribute('data-status', 'succeeded')
    expect(banner).toHaveTextContent('3 条')
    expect(screen.getByTestId('board-split-load-cards')).toBeInTheDocument()
  })

  it('failed → 显示错误', () => {
    mockDetail = makeRun({ status: 'failed', error: 'API 超时', finished_at: '2026-08-07T01:00:00Z' })
    render(
      <PrdSplitResultBanner
        requirementId="req-1"
        runId="prd-1"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    const banner = screen.getByTestId('board-split-result-banner')
    expect(banner).toHaveAttribute('data-status', 'failed')
    expect(banner).toHaveTextContent('API 超时')
  })

  it('isError → 错误 banner', () => {
    mockIsError = true
    render(
      <PrdSplitResultBanner
        requirementId="req-1"
        runId="prd-1"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTestId('board-split-result-banner')).toHaveAttribute(
      'data-status',
      'error',
    )
  })

  it('[载入到看板] → onReview', () => {
    mockDetail = makeRun({ status: 'succeeded', actual_count: 1, finished_at: '2026-08-07T01:00:00Z' })
    mockDetail.cards = [{ ordinal: 1, tool_use_id: 'a', title: '卡1', content: '', suggested_status: 'backlog', suggested_priority: null, labels: [] }]
    const onReview = vi.fn()
    render(
      <PrdSplitResultBanner
        requirementId="req-1"
        runId="prd-1"
        onReview={onReview}
        onDismiss={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTestId('board-split-load-cards'))
    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it('关闭 → onDismiss', () => {
    mockDetail = makeRun({ status: 'failed', error: 'x', finished_at: '2026-08-07T01:00:00Z' })
    const onDismiss = vi.fn()
    render(
      <PrdSplitResultBanner
        requirementId="req-1"
        runId="prd-1"
        onReview={vi.fn()}
        onDismiss={onDismiss}
      />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTestId('board-split-result-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
