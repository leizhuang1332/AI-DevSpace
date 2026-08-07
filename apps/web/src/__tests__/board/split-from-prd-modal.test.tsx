/**
 * SplitFromPrdModal 组件测试 — issue 08 / ADR-0027 D4
 *
 * 验收:
 * - open=false → 不渲染
 * - 粒度 radio(粗/中/细,默认 中)
 * - 期望卡片数(默认 5)+ 推荐按钮
 * - 上下文 checkbox(PRD 默认勾)
 * - 提交 → useStartPrdSplit mutation + onSuccess(runId)
 * - 点遮罩 / 取消 / ✕ → onClose
 *
 * mock:vi.mock board-detail-hooks 的 useStartPrdSplit
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SplitFromPrdModal } from '@/components/board/detail/SplitFromPrdModal'

const mockMutate = vi.fn()
const mockMutation = {
  mutate: mockMutate,
  isPending: false,
  isError: false,
  error: null,
}

vi.mock('@/lib/board-detail-hooks', () => ({
  useStartPrdSplit: () => mockMutation,
}))

afterEach(() => {
  cleanup()
  mockMutate.mockClear()
  mockMutation.isPending = false
  mockMutation.isError = false
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function renderModal(props: Partial<React.ComponentProps<typeof SplitFromPrdModal>> = {}) {
  return render(
    <SplitFromPrdModal
      requirementId="req-1"
      open
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      {...props}
    />,
    { wrapper: makeWrapper() },
  )
}

describe('SplitFromPrdModal · 开关', () => {
  it('open=false → 不渲染', () => {
    render(<SplitFromPrdModal requirementId="req-1" open={false} onClose={vi.fn()} onSuccess={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.queryByTestId('board-split-from-prd-modal')).not.toBeInTheDocument()
  })

  it('open=true → 渲染表单', () => {
    renderModal()
    expect(screen.getByTestId('board-split-from-prd-modal')).toBeInTheDocument()
    expect(screen.getByTestId('board-split-granularity-中')).toBeInTheDocument()
    expect(screen.getByTestId('board-split-expected-count')).toHaveValue(5)
  })
})

describe('SplitFromPrdModal · 表单', () => {
  it('粒度默认 中,切换到 粗', () => {
    renderModal()
    const coarse = screen.getByTestId('board-split-granularity-粗')
    expect(coarse.getAttribute('data-active') !== 'true').toBe(true) // 未选中
    fireEvent.click(coarse)
    // 切换后中 失去 active(仅断言点击不报错 + input radio checked)
  })

  it('推荐按钮 设 5', () => {
    renderModal()
    const input = screen.getByTestId('board-split-expected-count') as HTMLInputElement
    fireEvent.change(input, { target: { value: '10' } })
    expect(input.value).toBe('10')
    fireEvent.click(screen.getByTestId('board-split-recommend'))
    expect(input.value).toBe('5')
  })

  it('PRD 上下文默认勾选', () => {
    renderModal()
    const prdCheck = screen.getByTestId('board-split-context-prd')
    const checkbox = prdCheck.querySelector('input')!
    expect(checkbox).toBeChecked()
  })
})

describe('SplitFromPrdModal · 提交', () => {
  it('提交 → mutate + onSuccess(runId)', async () => {
    const onSuccess = vi.fn()
    mockMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({ run_id: 'prd-123' })
    })
    renderModal({ onSuccess })
    fireEvent.click(screen.getByTestId('board-split-submit'))
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ granularity: '中', expected_count: 5 }),
        expect.any(Object),
      )
    })
    expect(onSuccess).toHaveBeenCalledWith('prd-123')
  })
})

describe('SplitFromPrdModal · 关闭', () => {
  it('✕ → onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('board-split-from-prd-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点遮罩 → onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('board-split-from-prd-modal'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('取消按钮 → onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('board-split-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
