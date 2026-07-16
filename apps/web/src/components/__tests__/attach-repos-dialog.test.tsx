import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AttachReposDialog,
  validateBranchName,
  type AttachReposDialogProps,
} from '../attach-repos-dialog'

// ============================================================================
// Fixture
// ============================================================================

const REPOS: AttachReposDialogProps['availableRepos'] = [
  { id: 'repo-refund', name: 'refund-service' },
  { id: 'repo-order', name: 'order-service' },
  { id: 'repo-payment', name: 'payment-gateway' },
]

afterEach(() => cleanup())

function renderDialog(
  props: Partial<AttachReposDialogProps> = {},
): {
  onSubmit: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  container: HTMLElement
} {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <AttachReposDialog
      open
      mode="first"
      titlePrefix="关联仓库"
      requirementTitle="退款功能优化"
      availableRepos={REPOS}
      pickedRepoIds={[]}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  )
  return { onSubmit, onClose, container: utils.container }
}

// ============================================================================
// validateBranchName 纯函数
// ============================================================================

describe('validateBranchName', () => {
  it('空字符串 / 全空白 → 失败', () => {
    expect(validateBranchName('').ok).toBe(false)
    expect(validateBranchName('   ').ok).toBe(false)
  })

  it('普通合法名 → 通过', () => {
    const r = validateBranchName('feat/refund-optimization')
    expect(r.ok).toBe(true)
    expect(r.sanitized).toBe('feat/refund-optimization')
  })

  it('含路径非法字符 → 过滤后通过', () => {
    const r = validateBranchName('feat\\bad:name*?')
    expect(r.ok).toBe(true)
    // 路径非法字符被剥离
    expect(r.sanitized).not.toContain('\\')
    expect(r.sanitized).not.toContain(':')
    expect(r.sanitized).not.toContain('*')
    expect(r.sanitized).not.toContain('?')
  })

  it('> 100 字 → 失败', () => {
    const r = validateBranchName('a'.repeat(101))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('100')
  })
})

// ============================================================================
// 渲染条件
// ============================================================================

describe('AttachReposDialog · 渲染', () => {
  it('open=false → 不渲染 DOM', () => {
    const { container } = renderDialog({ open: false })
    expect(container.firstChild).toBeNull()
  })

  it('first 模式 → 标题 = "关联仓库 · <title>"', () => {
    renderDialog({ mode: 'first' })
    const title = screen.getByTestId('attach-repos-dialog-title')
    expect(title.textContent).toContain('关联仓库')
    expect(title.textContent).toContain('退款功能优化')
  })

  it('append 模式 → 标题 = "追加仓库 · <title>" + 紫色锁定 banner', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/refund-optimization',
    })
    const title = screen.getByTestId('attach-repos-dialog-title')
    expect(title.textContent).toContain('追加仓库')
    expect(title.textContent).toContain('退款功能优化')
    const locked = screen.getByTestId('attach-repos-dialog-locked-banner')
    expect(locked.textContent).toContain('feat/refund-optimization')
    expect(locked.textContent).toContain('创建时已锁定')
  })

  it('first 模式 → 不显示锁定 banner', () => {
    renderDialog({ mode: 'first' })
    expect(
      screen.queryByTestId('attach-repos-dialog-locked-banner'),
    ).toBeNull()
  })

  it('append 模式 → 不显示分支名 input', () => {
    renderDialog({ mode: 'append', lockedBranchName: 'feat/x' })
    expect(screen.queryByTestId('attach-repos-dialog-branch')).toBeNull()
  })

  it('first 模式 → 显示分支名 input + hint', () => {
    renderDialog({ mode: 'first' })
    expect(screen.getByTestId('attach-repos-dialog-branch')).toBeInTheDocument()
    expect(
      screen.getByTestId('attach-repos-dialog-branch')
        .getAttribute('placeholder'),
    ).toBe('feat/<slug>')
    expect(screen.getByTestId('attach-repos-dialog-branch').getAttribute('maxLength')).toBe('100')
  })

  it('availableRepos 为空 → 显示 "暂无可选仓库" 占位', () => {
    renderDialog({ availableRepos: [] })
    expect(
      screen.getByTestId('attach-repos-dialog-repo-list').textContent,
    ).toContain('暂无可选仓库')
  })

  it('checkbox 列表渲染所有 repos', () => {
    renderDialog()
    const opts = screen.getAllByTestId('attach-repos-dialog-repo-option')
    expect(opts).toHaveLength(REPOS.length)
    expect(
      opts.find((o) => o.getAttribute('data-repo-id') === 'repo-refund'),
    ).toBeDefined()
    expect(
      opts.find((o) => o.getAttribute('data-repo-id') === 'repo-order'),
    ).toBeDefined()
  })

  it('pickedRepoIds 已选 → 默认勾选', () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })
    const refund = screen
      .getAllByTestId('attach-repos-dialog-repo-option')
      .find((o) => o.getAttribute('data-repo-id') === 'repo-refund')!
    expect(refund.getAttribute('data-checked')).toBe('true')
  })

  it('dialog role=dialog + aria-modal=true', () => {
    renderDialog()
    const dialog = screen.getByTestId('attach-repos-dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('480px 宽 + z-index ≥ 300', () => {
    renderDialog()
    const dialog = screen.getByTestId('attach-repos-dialog')
    expect(dialog.className).toContain('w-[480px]')
    expect(dialog.className).toContain('z-[301]')
  })
})

// ============================================================================
// 仓库选择(checkbox 切换)
// ============================================================================

describe('AttachReposDialog · checkbox 切换', () => {
  it('点击 checkbox → 切换 on/off 状态', async () => {
    renderDialog()
    const user = userEvent.setup()
    const refundOpt = screen
      .getAllByTestId('attach-repos-dialog-repo-option')
      .find((o) => o.getAttribute('data-repo-id') === 'repo-refund')!
    expect(refundOpt.getAttribute('data-checked')).toBe('false')
    await user.click(refundOpt)
    expect(refundOpt.getAttribute('data-checked')).toBe('true')
    await user.click(refundOpt)
    expect(refundOpt.getAttribute('data-checked')).toBe('false')
  })
})

// ============================================================================
// 校验 + 提交
// ============================================================================

describe('AttachReposDialog · 校验 + 提交', () => {
  it('first 模式:仓库空 + 分支名空 → 提交按钮 disabled', () => {
    renderDialog()
    expect(screen.getByTestId('attach-repos-dialog-submit')).toBeDisabled()
  })

  it('first 模式:只勾仓库,未填分支名 → 提交按钮 disabled', async () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })
    const user = userEvent.setup()
    // 分支名仍为空,即使仓库勾选也不可提交
    expect(screen.getByTestId('attach-repos-dialog-submit')).toBeDisabled()
  })

  it('first 模式:含非法字符的分支名 → 实时过滤', async () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'feat\\bad:name' } })
    expect(input.value).not.toContain('\\')
    expect(input.value).not.toContain(':')
  })

  it('first 模式:含内部空白的分支名 → 实时过滤(UI-POLISH-SPEC §9.3 禁止空白)', async () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'feat bad name' } })
    expect(input.value).not.toMatch(/\s/)
  })

  it('first 模式:分支名空白 → blur 后显示错误', async () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('attach-repos-dialog-branch-error')).toBeInTheDocument()
  })

  it('first 模式:勾 1 仓库 + 填分支名 → 提交按钮 enabled,提交携带正确 payload', async () => {
    const { onSubmit } = renderDialog()
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-refund')!,
    )
    fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
      target: { value: 'feat/refund-optimization' },
    })
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      repoIds: ['repo-refund'],
      branchName: 'feat/refund-optimization',
    })
  })

  it('append 模式:无需填分支名,提交携带 lockedBranchName', async () => {
    const { onSubmit } = renderDialog({
      mode: 'append',
      lockedBranchName: 'feat/refund-optimization',
    })
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-order')!,
    )
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit).toHaveBeenCalledWith({
      repoIds: ['repo-order'],
      branchName: 'feat/refund-optimization',
    })
  })

  it('first 模式:footer 左侧展示 "此分支将应用于 N 个仓库"', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-refund')!,
    )
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-order')!,
    )
    expect(
      screen.getByTestId('attach-repos-dialog-footer-left').textContent,
    ).toContain('此分支将应用于 2 个仓库')
  })
})

// ============================================================================
// 关闭路径
// ============================================================================

describe('AttachReposDialog · 关闭路径', () => {
  it('点 ✕ → onClose 触发', async () => {
    const { onClose } = renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('attach-repos-dialog-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点 取消 → onClose 触发', async () => {
    const { onClose } = renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('attach-repos-dialog-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ESC → onClose 触发', async () => {
    const { onClose } = renderDialog()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('焦点陷阱:Tab 在末元素 → 回到首元素(issue 01 ticket 验收 #12)', async () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })

    // 把焦点放到最后一个可聚焦元素(提交按钮):先填分支名以启用 submit
    const branchInput = screen.getByTestId('attach-repos-dialog-branch')
    fireEvent.change(branchInput, { target: { value: 'feat/x' } })
    const submit = screen.getByTestId('attach-repos-dialog-submit')
    submit.focus()
    expect(document.activeElement).toBe(submit)

    // 用 fireEvent 直接派发 Tab keydown(避免 user-event 默认 focus 行为掩盖我们的 preventDefault)
    fireEvent.keyDown(submit, { key: 'Tab' })
    const close = screen.getByTestId('attach-repos-dialog-close')
    expect(document.activeElement).toBe(close)
  })

  it('焦点陷阱:Shift+Tab 在首元素 → 跳到末元素', async () => {
    renderDialog({ pickedRepoIds: ['repo-refund'] })

    // 先填分支名以启用 submit
    const branchInput = screen.getByTestId('attach-repos-dialog-branch')
    fireEvent.change(branchInput, { target: { value: 'feat/x' } })

    // 把焦点放到第一个可聚焦元素(关闭按钮)
    const close = screen.getByTestId('attach-repos-dialog-close')
    close.focus()
    expect(document.activeElement).toBe(close)

    // 用 fireEvent 直接派发 Shift+Tab keydown
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    const submit = screen.getByTestId('attach-repos-dialog-submit')
    expect(document.activeElement).toBe(submit)
  })

  it('点 backdrop → onClose 触发', async () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByTestId('attach-repos-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// 打开时 reset
// ============================================================================

describe('AttachReposDialog · 打开时 reset', () => {
  it('open 切换 false → true 清空之前输入', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <AttachReposDialog
        open
        mode="first"
        titlePrefix="关联仓库"
        requirementTitle="退款功能优化"
        availableRepos={REPOS}
        pickedRepoIds={[]}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
      target: { value: 'feat/old' },
    })
    rerender(
      <AttachReposDialog
        open={false}
        mode="first"
        titlePrefix="关联仓库"
        requirementTitle="退款功能优化"
        availableRepos={REPOS}
        pickedRepoIds={[]}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    rerender(
      <AttachReposDialog
        open
        mode="first"
        titlePrefix="关联仓库"
        requirementTitle="退款功能优化"
        availableRepos={REPOS}
        pickedRepoIds={[]}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    expect(input.value).toBe('')
  })
})