/**
 * StatusConstraintModal 组件测试 — issue 08 / ADR-0025 D2 + D5
 *
 * 验收:
 * - open=false → 不渲染
 * - open=true → 渲染 标题 + 父 status + 待切 status + conflicts 列表
 * - 三选项渲染 + 点击触发回调(force / adjust / cancel)
 * - 点遮罩 → onCancel
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { StatusConstraintModal } from '@/components/board/detail/StatusConstraintModal'

afterEach(() => cleanup())

const CONFLICTS = [
  {
    card_id: '01J7X3K2P5EVR0Z3YQJD8HFAB',
    card_status: 'backlog' as const,
    rule: 'no_backlog_for_implementing' as const,
  },
  {
    card_id: '01J7X3K2P5EVR0Z3YQJD8HFCD',
    card_status: 'backlog' as const,
    rule: 'no_backlog_for_implementing' as const,
  },
]

describe('StatusConstraintModal · 开关', () => {
  it('open=false → 不渲染', () => {
    render(
      <StatusConstraintModal
        open={false}
        conflicts={[]}
        parentStatus=""
        pendingStatus=""
        onForceSwitch={vi.fn()}
        onAdjustChildren={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('board-status-constraint-modal')).not.toBeInTheDocument()
  })

  it('open=true → 渲染', () => {
    render(
      <StatusConstraintModal
        open
        conflicts={CONFLICTS}
        parentStatus="implementing"
        pendingStatus="in_progress"
        onForceSwitch={vi.fn()}
        onAdjustChildren={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-status-constraint-modal')).toBeInTheDocument()
    expect(screen.getByTestId('board-status-constraint-modal')).toHaveTextContent(
      'implementing',
    )
    expect(screen.getByTestId('board-status-constraint-modal')).toHaveTextContent(
      'in_progress',
    )
  })
})

describe('StatusConstraintModal · conflicts', () => {
  it('渲染 conflicts 列表', () => {
    render(
      <StatusConstraintModal
        open
        conflicts={CONFLICTS}
        parentStatus="implementing"
        pendingStatus="in_progress"
        onForceSwitch={vi.fn()}
        onAdjustChildren={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const items = screen.getAllByTestId('board-status-constraint-conflict')
    expect(items).toHaveLength(2)
    // rule 中文
    expect(screen.getByTestId('board-status-constraint-conflicts')).toHaveTextContent(
      '父 status=implementing 要求无 backlog 卡',
    )
  })
})

describe('StatusConstraintModal · 三选项', () => {
  function renderModal() {
    const onForceSwitch = vi.fn()
    const onAdjustChildren = vi.fn()
    const onCancel = vi.fn()
    render(
      <StatusConstraintModal
        open
        conflicts={CONFLICTS}
        parentStatus="implementing"
        pendingStatus="in_progress"
        onForceSwitch={onForceSwitch}
        onAdjustChildren={onAdjustChildren}
        onCancel={onCancel}
      />,
    )
    return { onForceSwitch, onAdjustChildren, onCancel }
  }

  it('强制切换 → onForceSwitch', () => {
    const { onForceSwitch } = renderModal()
    fireEvent.click(screen.getByTestId('board-status-modal-force'))
    expect(onForceSwitch).toHaveBeenCalledTimes(1)
  })

  it('先调整子卡 → onAdjustChildren', () => {
    const { onAdjustChildren } = renderModal()
    fireEvent.click(screen.getByTestId('board-status-modal-adjust'))
    expect(onAdjustChildren).toHaveBeenCalledTimes(1)
  })

  it('取消 → onCancel', () => {
    const { onCancel } = renderModal()
    fireEvent.click(screen.getByTestId('board-status-modal-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点遮罩 → onCancel', () => {
    const { onCancel } = renderModal()
    fireEvent.click(screen.getByTestId('board-status-constraint-modal'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点 panel 不触发 onCancel(stopPropagation)', () => {
    const { onCancel } = renderModal()
    fireEvent.click(screen.getByTestId('board-status-constraint-modal-panel'))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
