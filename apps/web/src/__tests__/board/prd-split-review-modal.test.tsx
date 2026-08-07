/**
 * PrdSplitReviewModal 组件测试 — issue 08 / ADR-0027 D4
 *
 * 验收:
 * - open=false → 不渲染
 * - 渲染候选卡片列表(checkbox + title + priority 下拉)
 * - 取消勾选某条
 * - [全部确认] → useLandPrdSplitCard × N + onLanded(count)
 *
 * mock:vi.mock board-detail-hooks 的 usePrdSplitRunDetail + useLandPrdSplitCard
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrdSplitReviewModal } from '@/components/board/detail/PrdSplitReviewModal'
import type { PrdSplitRunDetailResponse } from '@ai-devspace/shared'

let mockDetail: PrdSplitRunDetailResponse | null = null
const mockLandMutate = vi.fn().mockResolvedValue(undefined)
const mockLandMutation = {
  mutate: mockLandMutate,
  mutateAsync: mockLandMutate,
  isPending: false,
  isError: false,
  error: null,
}

vi.mock('@/lib/board-detail-hooks', () => ({
  usePrdSplitRunDetail: () => ({ detail: mockDetail, isError: false, isLoading: false }),
  useLandPrdSplitCard: () => mockLandMutation,
}))

afterEach(() => {
  cleanup()
  mockDetail = null
  mockLandMutate.mockClear()
  mockLandMutation.isPending = false
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function makeDetailWithCards(): PrdSplitRunDetailResponse {
  return {
    run: {
      schema_version: 1,
      run_id: 'prd-1',
      requirement_id: 'req-1',
      status: 'succeeded',
      created_at: '2026-08-07T00:00:00Z',
      finished_at: '2026-08-07T01:00:00Z',
      error: null,
      granularity: '中',
      expected_count: 3,
      actual_count: 2,
    },
    cards: [
      { ordinal: 1, tool_use_id: 'a', title: '候选卡1', content: '内容1', suggested_status: 'backlog', suggested_priority: 'high', labels: ['sec'] },
      { ordinal: 2, tool_use_id: 'b', title: '候选卡2', content: '内容2', suggested_status: 'backlog', suggested_priority: null, labels: [] },
    ],
  } as PrdSplitRunDetailResponse
}

describe('PrdSplitReviewModal · 开关', () => {
  it('open=false → 不渲染', () => {
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open={false}
        onClose={vi.fn()}
        onLanded={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.queryByTestId('board-split-review-modal')).not.toBeInTheDocument()
  })

  it('open=true → 渲染候选列表', () => {
    mockDetail = makeDetailWithCards()
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={vi.fn()}
        onLanded={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByTestId('board-split-review-modal')).toBeInTheDocument()
    const cards = screen.getAllByTestId('board-split-review-card')
    expect(cards).toHaveLength(2)
    expect(screen.getByText('候选卡1')).toBeInTheDocument()
  })

  it('无候选卡片 → 空态', () => {
    mockDetail = { run: { schema_version: 1, run_id: 'p', requirement_id: 'r', status: 'succeeded' as const, created_at: '', finished_at: null, error: null, granularity: '中' as const, expected_count: 0, actual_count: 0 }, cards: [] } as PrdSplitRunDetailResponse
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={vi.fn()}
        onLanded={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText(/没有候选卡片/)).toBeInTheDocument()
  })
})

describe('PrdSplitReviewModal · 选择 + 确认', () => {
  it('全部确认 → land × N + onLanded(count)', async () => {
    mockDetail = makeDetailWithCards()
    const onLanded = vi.fn()
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={vi.fn()}
        onLanded={onLanded}
      />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTestId('board-split-review-confirm-all'))
    await waitFor(() => {
      expect(mockLandMutate).toHaveBeenCalledTimes(2)
    })
    expect(onLanded).toHaveBeenCalledWith(2)
  })

  it('取消勾选一条 → 只 land 1 条', async () => {
    mockDetail = makeDetailWithCards()
    const onLanded = vi.fn()
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={vi.fn()}
        onLanded={onLanded}
      />,
      { wrapper: makeWrapper() },
    )
    // 取消第一项
    fireEvent.click(screen.getByTestId('board-split-review-check-0'))
    fireEvent.click(screen.getByTestId('board-split-review-confirm-all'))
    await waitFor(() => {
      expect(mockLandMutate).toHaveBeenCalledTimes(1)
    })
    expect(onLanded).toHaveBeenCalledWith(1)
  })

  it('land mutation 传 source=prd_split 的 title + content + priority', async () => {
    mockDetail = makeDetailWithCards()
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={vi.fn()}
        onLanded={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTestId('board-split-review-confirm-all'))
    await waitFor(() => {
      expect(mockLandMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '候选卡1',
          content: '内容1',
          priority: 'high',
          labels: ['sec'],
        }),
      )
    })
  })
})

describe('PrdSplitReviewModal · 关闭', () => {
  it('✕ → onClose', () => {
    mockDetail = makeDetailWithCards()
    const onClose = vi.fn()
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={onClose}
        onLanded={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTestId('board-split-review-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('取消按钮 → onClose', () => {
    mockDetail = makeDetailWithCards()
    const onClose = vi.fn()
    render(
      <PrdSplitReviewModal
        requirementId="req-1"
        runId="prd-1"
        open
        onClose={onClose}
        onLanded={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    fireEvent.click(screen.getByTestId('board-split-review-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
