/**
 * NewTaskModal 组件测试 — issue 07 / ADR-0027 D3
 *
 * 验收:
 * - open=false → 不渲染
 * - open=true → 渲染表单(title / content / priority / status / assignee / labels)
 * - title 空 → 提交按钮 disabled
 * - 提交 → 调 useCreateBoardCard mutation(POST /board/cards)
 * - 成功后 → onClose
 * - defaultStatus 预填 status select
 * - 点遮罩 / 取消 / ✕ → onClose
 *
 * mock:vi.mock board-hooks 的 useCreateBoardCard,控制 mutation 状态。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewTaskModal } from '@/components/board/NewTaskModal'

// ---- 受控 mock:useCreateBoardCard ----
const mockMutate = vi.fn()
const mockMutation: {
  mutate: typeof mockMutate
  isPending: boolean
  isError: boolean
  error: unknown
} = {
  mutate: mockMutate,
  isPending: false,
  isError: false,
  error: null,
}

vi.mock('@/lib/board-hooks', () => ({
  useCreateBoardCard: () => mockMutation,
}))

afterEach(() => {
  cleanup()
  mockMutate.mockClear()
  mockMutation.isPending = false
  mockMutation.isError = false
  mockMutation.error = null
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function renderModal(props: React.ComponentProps<typeof NewTaskModal>) {
  return render(<NewTaskModal {...props} />, { wrapper: makeWrapper() })
}

describe('NewTaskModal · 开关', () => {
  it('open=false → 不渲染', () => {
    renderModal({ requirementId: 'req-007', open: false, onClose: vi.fn() })
    expect(screen.queryByTestId('board-new-task-modal')).toBeNull()
  })

  it('open=true → 渲染面板 + 表单字段', () => {
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    expect(screen.getByTestId('board-new-task-modal')).toBeInTheDocument()
    expect(screen.getByTestId('board-new-task-title')).toBeInTheDocument()
    expect(screen.getByTestId('board-new-task-content')).toBeInTheDocument()
    expect(screen.getByTestId('board-new-task-priority')).toBeInTheDocument()
    expect(screen.getByTestId('board-new-task-status')).toBeInTheDocument()
    expect(screen.getByTestId('board-new-task-assignee')).toBeInTheDocument()
    expect(screen.getByTestId('board-new-task-labels')).toBeInTheDocument()
  })
})

describe('NewTaskModal · 表单校验', () => {
  it('title 空 → 提交按钮 disabled', () => {
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    const submit = screen.getByTestId('board-new-task-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('填 title → 提交按钮 enabled', () => {
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    fireEvent.change(screen.getByTestId('board-new-task-title'), {
      target: { value: '新建任务标题' },
    })
    const submit = screen.getByTestId('board-new-task-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('defaultStatus 预填 status select', () => {
    renderModal({
      requirementId: 'req-007',
      open: true,
      onClose: vi.fn(),
      defaultStatus: 'in_progress',
    })
    const status = screen.getByTestId('board-new-task-status') as HTMLSelectElement
    expect(status.value).toBe('in_progress')
  })
})

describe('NewTaskModal · 提交', () => {
  it('提交 → mutate 调用 + 正确 payload(title/content/status/priority/assignee/labels)', () => {
    const onClose = vi.fn()
    renderModal({ requirementId: 'req-007', open: true, onClose })
    fireEvent.change(screen.getByTestId('board-new-task-title'), {
      target: { value: '新建任务标题' },
    })
    fireEvent.change(screen.getByTestId('board-new-task-content'), {
      target: { value: '任务详细描述' },
    })
    fireEvent.change(screen.getByTestId('board-new-task-priority'), {
      target: { value: 'high' },
    })
    fireEvent.change(screen.getByTestId('board-new-task-status'), {
      target: { value: 'todo' },
    })
    fireEvent.change(screen.getByTestId('board-new-task-assignee'), {
      target: { value: 'user-a' },
    })
    fireEvent.change(screen.getByTestId('board-new-task-labels'), {
      target: { value: 'security, backend' },
    })
    fireEvent.click(screen.getByTestId('board-new-task-submit'))

    expect(mockMutate).toHaveBeenCalledOnce()
    const [payload, opts] = mockMutate.mock.calls[0]
    expect(payload).toEqual({
      title: '新建任务标题',
      content: '任务详细描述',
      status: 'todo',
      priority: 'high',
      assignee: 'user-a',
      labels: ['security', 'backend'],
    })
    // onSuccess 回调 onClose(由调用方 mutate 的第二参 opts.onSuccess 触发)
    expect(typeof opts.onSuccess).toBe('function')
    opts.onSuccess()
    expect(onClose).toHaveBeenCalled()
  })

  it('priority=none → payload.priority=null', () => {
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    fireEvent.change(screen.getByTestId('board-new-task-title'), {
      target: { value: '标题' },
    })
    fireEvent.click(screen.getByTestId('board-new-task-submit'))
    const [payload] = mockMutate.mock.calls[0]
    expect(payload.priority).toBeNull()
  })

  it('assignee 空 → payload.assignee=null', () => {
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    fireEvent.change(screen.getByTestId('board-new-task-title'), {
      target: { value: '标题' },
    })
    fireEvent.click(screen.getByTestId('board-new-task-submit'))
    const [payload] = mockMutate.mock.calls[0]
    expect(payload.assignee).toBeNull()
  })

  it('labels 空 → payload.labels=[]', () => {
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    fireEvent.change(screen.getByTestId('board-new-task-title'), {
      target: { value: '标题' },
    })
    fireEvent.click(screen.getByTestId('board-new-task-submit'))
    const [payload] = mockMutate.mock.calls[0]
    expect(payload.labels).toEqual([])
  })

  it('mutation pending → 提交按钮 disabled + 文案「创建中…」', () => {
    mockMutation.isPending = true
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    const submit = screen.getByTestId('board-new-task-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toBe('创建中…')
  })

  it('mutation error → 渲染错误提示', () => {
    mockMutation.isError = true
    mockMutation.error = new Error('boom')
    renderModal({ requirementId: 'req-007', open: true, onClose: vi.fn() })
    const err = screen.getByTestId('board-new-task-error')
    expect(err.textContent).toContain('创建失败')
  })
})

describe('NewTaskModal · 关闭', () => {
  it('点遮罩 → onClose', () => {
    const onClose = vi.fn()
    renderModal({ requirementId: 'req-007', open: true, onClose })
    fireEvent.click(screen.getByTestId('board-new-task-modal'))
    expect(onClose).toHaveBeenCalled()
  })

  it('点遮罩内的面板 → 不关闭(stopPropagation)', () => {
    const onClose = vi.fn()
    renderModal({ requirementId: 'req-007', open: true, onClose })
    fireEvent.click(screen.getByTestId('board-new-task-modal-panel'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点 ✕ → onClose', () => {
    const onClose = vi.fn()
    renderModal({ requirementId: 'req-007', open: true, onClose })
    fireEvent.click(screen.getByTestId('board-new-task-modal-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('点取消 → onClose', () => {
    const onClose = vi.fn()
    renderModal({ requirementId: 'req-007', open: true, onClose })
    fireEvent.click(screen.getByTestId('board-new-task-cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
