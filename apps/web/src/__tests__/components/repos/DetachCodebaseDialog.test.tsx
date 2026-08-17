/**
 * DetachCodebaseDialog 组件测试 — ADR-0034
 *
 * 验收(Q3 / Q8):
 * - open=false → 不渲染
 * - open=true → 渲染仓库名 + 警告文案 + codebase 路径
 * - 点确认 → 调 onConfirm(resolve 后无需手动关)
 * - onConfirm reject → 错误 banner 显示,按钮恢复可用
 * - 点取消 / ✕ / 遮罩 → onCancel
 * - submitting 期间按钮 disabled
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentError } from '@/lib/agent-client'
import { DetachCodebaseDialog } from '@/components/repos/DetachCodebaseDialog'

afterEach(() => cleanup())

const REQ_ID = 'req-012-test'
const REPO_NAME = 'multica'

function renderDialog(
  props: Partial<React.ComponentProps<typeof DetachCodebaseDialog>> = {},
) {
  return render(
    <DetachCodebaseDialog
      open={true}
      reqId={REQ_ID}
      repoName={REPO_NAME}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      {...props}
    />,
  )
}

describe('DetachCodebaseDialog · 开关', () => {
  it('open=false → 不渲染', () => {
    renderDialog({ open: false })
    expect(screen.queryByTestId('detach-codebase-dialog')).toBeNull()
  })

  it('open=true → 渲染仓库名 + 警告文案 + 路径', () => {
    renderDialog()
    expect(screen.getByTestId('detach-codebase-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('detach-codebase-dialog-title').textContent).toContain(
      REPO_NAME,
    )
    expect(screen.getByTestId('detach-codebase-dialog-warning')).toBeInTheDocument()
    expect(screen.getByTestId('detach-codebase-dialog-path').textContent).toContain(
      REQ_ID,
    )
    expect(screen.getByTestId('detach-codebase-dialog-path').textContent).toContain(
      REPO_NAME,
    )
  })
})

describe('DetachCodebaseDialog · 交互', () => {
  it('点确认 → 调 onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onConfirm })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('detach-codebase-dialog-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('点取消 → onCancel', async () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('detach-codebase-dialog-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('点 ✕ → onCancel', async () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('detach-codebase-dialog-close'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('点遮罩 → onCancel', async () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    const user = userEvent.setup()
    // 遮罩是 dialog 自身(panel 通过 stopPropagation 阻止冒泡)
    await user.click(screen.getByTestId('detach-codebase-dialog'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('点遮罩内面板 → 不关闭(stopPropagation)', async () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('detach-codebase-dialog-panel'))
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('DetachCodebaseDialog · submitting / error 状态(Q8 悲观更新)', () => {
  it('onConfirm resolve 期间按钮显示「删除中…」且 disabled', async () => {
    let resolveConfirm!: () => void
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        }),
    )
    renderDialog({ onConfirm })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('detach-codebase-dialog-confirm'))

    // submitting=true 期间:按钮 disabled + 文字「删除中…」
    const confirmBtn = screen.getByTestId('detach-codebase-dialog-confirm')
    expect(confirmBtn).toBeDisabled()
    expect(confirmBtn.textContent).toContain('删除中')

    resolveConfirm()
    await waitFor(() => {
      expect(screen.getByTestId('detach-codebase-dialog-confirm')).not.toBeDisabled()
    })
  })

  it('onConfirm reject → error banner 显示,按钮恢复', async () => {
    // 后端已不再返 E_REQUIREMENT_NOT_DRAFTING,改测更通用的 E_INTERNAL
    // —— dialog 的悲观更新路径仍走通,错误码翻译走 default 分支展示 message。
    const onConfirm = vi.fn().mockRejectedValue(
      new AgentError(500, {
        error: 'E_INTERNAL',
        message: 'safeRm failed: EBUSY',
      }),
    )
    renderDialog({ onConfirm })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('detach-codebase-dialog-confirm'))

    // 等 error banner 出现
    const errorBanner = await screen.findByTestId('detach-codebase-dialog-error')
    expect(errorBanner.textContent).toContain('safeRm failed')

    // 按钮恢复可用
    const confirmBtn = screen.getByTestId('detach-codebase-dialog-confirm')
    expect(confirmBtn).not.toBeDisabled()
    expect(confirmBtn.textContent).toContain('确认')
  })

  it('onConfirm reject 普通 Error → error banner 显示 message', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('network timeout'))
    renderDialog({ onConfirm })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('detach-codebase-dialog-confirm'))

    const errorBanner = await screen.findByTestId('detach-codebase-dialog-error')
    expect(errorBanner.textContent).toContain('network timeout')
  })

  it('open 从 false → true 重置 error(防止上次失败残留)', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(
      new AgentError(500, { error: 'E_INTERNAL', message: 'first fail' }),
    )
    const { rerender } = render(
      <DetachCodebaseDialog
        open={true}
        reqId={REQ_ID}
        repoName={REPO_NAME}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('detach-codebase-dialog-confirm'))
    await screen.findByTestId('detach-codebase-dialog-error')

    // 关 → 开:error 应被 useEffect 重置
    rerender(
      <DetachCodebaseDialog
        open={false}
        reqId={REQ_ID}
        repoName={REPO_NAME}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    rerender(
      <DetachCodebaseDialog
        open={true}
        reqId={REQ_ID}
        repoName={REPO_NAME}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('detach-codebase-dialog-error')).toBeNull()
  })
})