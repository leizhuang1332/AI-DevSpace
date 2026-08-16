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
//
// issue 06 (ADR-0030 D3):repo 字段从 `{ id, name }` 改为
//   `{ name, gitUrl, description }`,name 即标识。
// 这里只保留最小集(name / gitUrl / description),不传 id ——
// 验证组件确实从 `name` 读取,不依赖 id。

const REPOS: AttachReposDialogProps['availableRepos'] = [
  {
    name: 'refund-service',
    gitUrl: 'https://example.com/refund-service.git',
    description: '退款主服务',
  },
  {
    name: 'order-service',
    gitUrl: 'https://example.com/order-service.git',
    description: '订单服务',
  },
  {
    name: 'payment-gateway',
    gitUrl: 'https://example.com/payment-gateway.git',
    description: '支付网关',
  },
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
      pickedRepoNames={[]}
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

  it('checkbox 列表渲染所有 repos(数据源 = name)', () => {
    renderDialog()
    const opts = screen.getAllByTestId('attach-repos-dialog-repo-option')
    expect(opts).toHaveLength(REPOS.length)
    // 数据属性已切到 name
    expect(
      opts.find((o) => o.getAttribute('data-repo-name') === 'refund-service'),
    ).toBeDefined()
    expect(
      opts.find((o) => o.getAttribute('data-repo-name') === 'order-service'),
    ).toBeDefined()
    // 不再有 data-repo-id(已经 deprecated)
    opts.forEach((o) => expect(o.getAttribute('data-repo-id')).toBeNull())
  })

  it('pickedRepoNames 已选 → 默认勾选', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })
    const refund = screen
      .getAllByTestId('attach-repos-dialog-repo-option')
      .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!
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

  // -------------------------------------------------------------------------
  // 决策 Q14(issue 06 ticket):删除 Git URL 入口,改为跳转链接
  // -------------------------------------------------------------------------

  it('issue 06 (决策 Q14):"＋ 添加新仓库(粘贴 Git URL)" 入口已删除', () => {
    renderDialog()
    // 不再有 "添加新仓库" / "粘贴 Git URL" / "new-repo-url" / "show-new-repo"
    expect(screen.queryByTestId('attach-repos-dialog-new-repo-toggle')).toBeNull()
    expect(screen.queryByTestId('attach-repos-dialog-new-repo-url')).toBeNull()
    // 兜底:全文不出现 "添加新仓库"
    expect(document.body.textContent).not.toMatch(/添加新仓库/)
    expect(document.body.textContent).not.toMatch(/粘贴 Git URL/)
  })

  it('issue 06:底部 "没找到?去仓库页添加 →" 跳转链接默认指向 /repos', () => {
    renderDialog()
    const hint = screen.getByTestId('attach-repos-dialog-repos-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.textContent).toContain('没找到?')
    const link = screen.getByTestId('attach-repos-dialog-repos-link')
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/repos')
    expect(link.textContent).toContain('去仓库页添加')
  })

  it('issue 06:reposPageHref 显式传入 → 链接指向自定义地址', () => {
    renderDialog({ reposPageHref: '/repos?focus=new' })
    const link = screen.getByTestId('attach-repos-dialog-repos-link')
    expect(link.getAttribute('href')).toBe('/repos?focus=new')
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
      .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!
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

  it('first 模式:只勾仓库,未填分支名 → 提交按钮 disabled', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })
    // 分支名仍为空,即使仓库勾选也不可提交
    expect(screen.getByTestId('attach-repos-dialog-submit')).toBeDisabled()
  })

  it('first 模式:含非法字符的分支名 → 实时过滤', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'feat\\bad:name' } })
    expect(input.value).not.toContain('\\')
    expect(input.value).not.toContain(':')
  })

  it('first 模式:含内部空白的分支名 → 实时过滤(UI-POLISH-SPEC §9.3 禁止空白)', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'feat bad name' } })
    expect(input.value).not.toMatch(/\s/)
  })

  it('first 模式:分支名空白 → blur 后显示错误', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('attach-repos-dialog-branch-error')).toBeInTheDocument()
  })

  it('first 模式:勾 1 仓库 + 填分支名 → 提交按钮 enabled,提交携带正确 payload(repoNames / branchName)', async () => {
    const { onSubmit } = renderDialog()
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!,
    )
    fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
      target: { value: 'feat/refund-optimization' },
    })
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // 字段从 repoIds 改为 repoNames(issue 06 ADR-0030 D5)
    expect(onSubmit).toHaveBeenCalledWith({
      repoNames: ['refund-service'],
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
        .find((o) => o.getAttribute('data-repo-name') === 'order-service')!,
    )
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit).toHaveBeenCalledWith({
      repoNames: ['order-service'],
      branchName: 'feat/refund-optimization',
    })
  })

  it('first 模式:footer 左侧展示 "此分支将应用于 N 个仓库"', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!,
    )
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'order-service')!,
    )
    expect(
      screen.getByTestId('attach-repos-dialog-footer-left').textContent,
    ).toContain('此分支将应用于 2 个仓库')
  })

  // issue 06 ticket:删除 Git URL 后,提交数 = 选中数;不会出现 "+1 个待创建"
  it('issue 06:删除 URL 输入后,提交数严格等于 selectedNames.size(没有 "+1 个待创建")', async () => {
    const { onSubmit } = renderDialog()
    const user = userEvent.setup()
    // 勾 2 个 repo,提交数 = 2
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!,
    )
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'order-service')!,
    )
    fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
      target: { value: 'feat/x' },
    })
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit.mock.calls[0][0].repoNames).toHaveLength(2)
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

  it('焦点陷阱:Tab 在末元素 → 回到首元素(issue 01 ticket 验收 #12)', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })

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

  it('焦点陷阱:Shift+Tab 在首元素 → 跳到末元素', () => {
    renderDialog({ pickedRepoNames: ['refund-service'] })

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

  it('点 backdrop → onClose 触发', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByTestId('attach-repos-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// ADR-0033 / issue 18:append 模式增量追加
//   - 已关联仓库 = checkbox checked + disabled + 行末「✓ 已关联」徽章 + 置顶
//   - submit 时 filter 排除已关联(深度防御)
//   - footer 数字 = 本次新增数(不含已关联)
//   - 全已关联态 = 顶部绿色 banner + submit 文案改「已全部关联」 + disable
// ============================================================================

describe('AttachReposDialog · 增量追加(ADR-0033)', () => {
  // -----------------------------------------------------------------
  // 已关联仓库状态:disabled + 徽章 + 置顶
  // -----------------------------------------------------------------

  it('append + 已关联仓库 → checkbox checked + disabled', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service'],
    })
    const refundOpt = screen
      .getAllByTestId('attach-repos-dialog-repo-option')
      .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!
    const checkbox = screen
      .getAllByTestId('attach-repos-dialog-repo-checkbox')
      .find((c) => c.getAttribute('data-repo-name') === 'refund-service') as HTMLInputElement
    // 选中态 + disabled
    expect(refundOpt.getAttribute('data-checked')).toBe('true')
    expect(refundOpt.getAttribute('data-already-attached')).toBe('true')
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(true)
  })

  it('append + 已关联仓库 → 行末「✓ 已关联」徽章', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service'],
    })
    const badge = screen
      .getAllByTestId('attach-repos-dialog-repo-already-attached-badge')
      .find((b) => b.closest('[data-repo-name="refund-service"]'))!
    expect(badge.textContent).toContain('✓ 已关联')
  })

  it('append + 已关联仓库 → 排序置顶(同段内按 pickedRepoNames 顺序)', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      // pickedRepoNames 顺序:order-service, refund-service → 渲染也应如此
      pickedRepoNames: ['order-service', 'refund-service'],
    })
    const opts = screen.getAllByTestId('attach-repos-dialog-repo-option')
    expect(opts[0]?.getAttribute('data-repo-name')).toBe('order-service')
    expect(opts[1]?.getAttribute('data-repo-name')).toBe('refund-service')
    // 剩余未关联仓库按原顺序接在后面
    expect(opts[2]?.getAttribute('data-repo-name')).toBe('payment-gateway')
  })

  it('append + 未关联仓库 → checkbox 正常可勾(无 disabled + 无徽章)', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service'],
    })
    const orderOpt = screen
      .getAllByTestId('attach-repos-dialog-repo-option')
      .find((o) => o.getAttribute('data-repo-name') === 'order-service')!
    expect(orderOpt.getAttribute('data-already-attached')).toBe('false')
    const checkbox = screen
      .getAllByTestId('attach-repos-dialog-repo-checkbox')
      .find((c) => c.getAttribute('data-repo-name') === 'order-service') as HTMLInputElement
    expect(checkbox.disabled).toBe(false)
    expect(
      screen
        .queryAllByTestId('attach-repos-dialog-repo-already-attached-badge')
        .find((b) => b.closest('[data-repo-name="order-service"]')),
    ).toBeUndefined()
  })

  // -----------------------------------------------------------------
  // submit filter:深度防御 — 后端不收到已关联 name
  // -----------------------------------------------------------------

  it('append + 已关联 + 勾选新仓库 → submit 仅携带新 name', async () => {
    const { onSubmit } = renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/refund-optimization',
      pickedRepoNames: ['refund-service'],
    })
    const user = userEvent.setup()
    // 勾一个新仓库
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'order-service')!,
    )
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // 不含已关联 refund-service
    expect(onSubmit).toHaveBeenCalledWith({
      repoNames: ['order-service'],
      branchName: 'feat/refund-optimization',
    })
  })

  it('append + 仅已关联 + 勾选新仓库 → submit payload 长度 = 新增数', async () => {
    const { onSubmit } = renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service', 'order-service'],
    })
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'payment-gateway')!,
    )
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))
    expect(onSubmit.mock.calls[0][0].repoNames).toEqual(['payment-gateway'])
  })

  // -----------------------------------------------------------------
  // footer 数字 = 本次新增数(不含已关联)
  // -----------------------------------------------------------------

  it('append + 已关联 2 + 勾选 1 新 → footer "追加 1 个仓库"', async () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service', 'order-service'],
    })
    const user = userEvent.setup()
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-name') === 'payment-gateway')!,
    )
    expect(
      screen.getByTestId('attach-repos-dialog-footer-left').textContent,
    ).toContain('追加 1 个仓库')
  })

  it('append + 仅已关联 + 不勾新 → footer "追加 0 个仓库" + submit disable', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service'],
    })
    expect(
      screen.getByTestId('attach-repos-dialog-footer-left').textContent,
    ).toContain('追加 0 个仓库')
    expect(screen.getByTestId('attach-repos-dialog-submit')).toBeDisabled()
  })

  // -----------------------------------------------------------------
  // 全已关联态:绿色 banner + submit disable + 文案改「已全部关联」
  // -----------------------------------------------------------------

  it('append + 注册表全已关联 → 顶部绿色 banner 显示', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      // REPOS 全 3 个都在 pickedRepoNames
      pickedRepoNames: ['refund-service', 'order-service', 'payment-gateway'],
    })
    const banner = screen.getByTestId(
      'attach-repos-dialog-all-attached-banner',
    )
    expect(banner.textContent).toContain('✓')
    expect(banner.textContent).toContain('全部')
    expect(banner.textContent).toContain('3')
  })

  it('append + 注册表全已关联 → submit 按钮 disable + 文案 "已全部关联"', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service', 'order-service', 'payment-gateway'],
    })
    const submit = screen.getByTestId('attach-repos-dialog-submit')
    expect(submit).toBeDisabled()
    expect(submit.textContent).toContain('已全部关联')
  })

  it('append + 部分已关联 → 不显示 banner', () => {
    renderDialog({
      mode: 'append',
      titlePrefix: '追加仓库',
      lockedBranchName: 'feat/x',
      pickedRepoNames: ['refund-service'], // 还有 2 个未关联
    })
    expect(
      screen.queryByTestId('attach-repos-dialog-all-attached-banner'),
    ).toBeNull()
  })

  it('first + 全已关联(pickedRepoNames=REPOS)→ 不显示 banner(只 append 模式生效)', () => {
    renderDialog({
      mode: 'first',
      pickedRepoNames: ['refund-service', 'order-service', 'payment-gateway'],
    })
    expect(
      screen.queryByTestId('attach-repos-dialog-all-attached-banner'),
    ).toBeNull()
  })

  // -----------------------------------------------------------------
  // first 模式 = 零改动
  // -----------------------------------------------------------------

  it('first + pickedRepoNames 非空 → checkbox 不 disabled(零改动)', () => {
    renderDialog({
      mode: 'first',
      pickedRepoNames: ['refund-service'],
    })
    const refundOpt = screen
      .getAllByTestId('attach-repos-dialog-repo-option')
      .find((o) => o.getAttribute('data-repo-name') === 'refund-service')!
    expect(refundOpt.getAttribute('data-already-attached')).toBe('false')
    const checkbox = screen
      .getAllByTestId('attach-repos-dialog-repo-checkbox')
      .find((c) => c.getAttribute('data-repo-name') === 'refund-service') as HTMLInputElement
    expect(checkbox.disabled).toBe(false)
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
        pickedRepoNames={[]}
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
        pickedRepoNames={[]}
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
        pickedRepoNames={[]}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    const input = screen.getByTestId('attach-repos-dialog-branch') as HTMLInputElement
    expect(input.value).toBe('')
  })
})