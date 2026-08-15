/**
 * DeleteRepoDialog 组件测试 — issue 07 / ADR-0030 D6+Q7
 *
 * 验收:
 * - open=false → 不渲染
 * - open=true → 渲染仓库名 + 二次确认文案
 * - usageCount=0 → 文案「该仓库尚未被任何需求使用」
 * - usageCount>0 → 文案「该仓库正被 N 个需求使用」+ 影响说明
 * - 点确认 → onConfirm
 * - 点取消 / ✕ / 遮罩 → onCancel
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DeleteRepoDialog } from '@/components/repos/DeleteRepoDialog'

afterEach(() => cleanup())

const REPO = { name: 'refund-service', gitUrl: 'git@github.com:co/refund.git', description: '退款' }

function renderDialog(
  props: Partial<React.ComponentProps<typeof DeleteRepoDialog>> = {},
) {
  return render(
    <DeleteRepoDialog
      open={true}
      repo={REPO}
      usageCount={0}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  )
}

describe('DeleteRepoDialog · 开关', () => {
  it('open=false → 不渲染', () => {
    renderDialog({ open: false })
    expect(screen.queryByTestId('delete-repo-dialog')).toBeNull()
  })

  it('open=true → 渲染仓库名 + 二次确认文案', () => {
    renderDialog()
    expect(screen.getByTestId('delete-repo-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('delete-repo-dialog-title').textContent).toContain(
      'refund-service',
    )
  })
})

describe('DeleteRepoDialog · usageCount 文案差异', () => {
  it('usageCount=0 → 提示「尚未被任何需求使用」', () => {
    renderDialog({ usageCount: 0 })
    expect(screen.getByTestId('delete-repo-dialog-usage-zero')).toBeInTheDocument()
    expect(
      screen.queryByTestId('delete-repo-dialog-usage-nonzero'),
    ).toBeNull()
  })

  it('usageCount>0 → 提示「正被 N 个需求使用」+ codebase 不会被删除', () => {
    renderDialog({ usageCount: 3 })
    const nonzero = screen.getByTestId('delete-repo-dialog-usage-nonzero')
    expect(nonzero.textContent).toContain('3')
    expect(nonzero.textContent).toContain('codebase')
    expect(screen.queryByTestId('delete-repo-dialog-usage-zero')).toBeNull()
  })
})

describe('DeleteRepoDialog · 交互', () => {
  it('点确认 → onConfirm(repo)', () => {
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })
    fireEvent.click(screen.getByTestId('delete-repo-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(REPO)
  })

  it('点取消 → onCancel', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByTestId('delete-repo-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('点 ✕ → onCancel', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByTestId('delete-repo-dialog-close'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('点遮罩 → onCancel', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByTestId('delete-repo-dialog'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('点遮罩内面板 → 不关闭(stopPropagation)', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.click(screen.getByTestId('delete-repo-dialog-panel'))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
