import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftingBanner } from '../drafting-banner'

// ============================================================================
// Fixture
// ============================================================================

afterEach(() => cleanup())

function renderBanner(
  props: Partial<React.ComponentProps<typeof DraftingBanner>> = {},
) {
  const onRequestAttach = vi.fn()
  const onDismiss = vi.fn()
  const onRetry = vi.fn()
  const utils = render(
    <DraftingBanner
      state="success"
      onRequestAttach={onRequestAttach}
      onDismiss={onDismiss}
      onRetry={onRetry}
      {...props}
    />,
  )
  return { onRequestAttach, onDismiss, onRetry, ...utils }
}

// ============================================================================
// state='hidden' — 完全不渲染任何 DOM(spec §8.1 隐含语义)
// ============================================================================

describe('DraftingBanner · hidden 态', () => {
  it('state=hidden → 不渲染 banner DOM', () => {
    const { container } = renderBanner({ state: 'hidden' })
    expect(container.firstChild).toBeNull()
  })
})

// ============================================================================
// state='success' — 淡黄 banner(issue 01 ticket 验收 #2 #7)
// ============================================================================

describe('DraftingBanner · success 态', () => {
  it('渲染 banner + 文案 + 📦 图标 + [+ 关联仓库] + ✕', () => {
    renderBanner({ state: 'success' })
    const banner = screen.getByTestId('drafting-banner')
    expect(banner.getAttribute('data-banner-state')).toBe('success')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain('未关联任何仓库')
    expect(banner.textContent).toContain('添加仓库后将在 RepoBar 操作')
    expect(banner.textContent).toContain('📦')
    expect(screen.getByTestId('drafting-banner-plus')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-banner-close')).toBeInTheDocument()
  })

  it('点 [+] → onRequestAttach 触发 + 第二个参数 trigger="banner-plus"', async () => {
    const { onRequestAttach } = renderBanner({ state: 'success' })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-banner-plus'))
    expect(onRequestAttach).toHaveBeenCalledTimes(1)
    expect(onRequestAttach).toHaveBeenCalledWith('banner-plus')
  })

  it('点 ✕ → onDismiss 触发', async () => {
    const { onDismiss } = renderBanner({ state: 'success' })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-banner-close'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('不传 onRequestAttach → [+] 按钮不渲染', () => {
    renderBanner({ state: 'success', onRequestAttach: undefined })
    expect(screen.queryByTestId('drafting-banner-plus')).toBeNull()
    expect(screen.getByTestId('drafting-banner-close')).toBeInTheDocument()
  })

  it('不传 onDismiss → ✕ 按钮不渲染', () => {
    renderBanner({ state: 'success', onDismiss: undefined })
    expect(screen.getByTestId('drafting-banner-plus')).toBeInTheDocument()
    expect(screen.queryByTestId('drafting-banner-close')).toBeNull()
  })
})

// ============================================================================
// state='error' — 淡红 banner(issue 01 ticket 验收 #10)
// ============================================================================

describe('DraftingBanner · error 态', () => {
  it('渲染 banner + 错误文案 + [重试] 按钮(无 ✕)', () => {
    renderBanner({ state: 'error', errorMessage: '网络异常' })
    const banner = screen.getByTestId('drafting-banner')
    expect(banner.getAttribute('data-banner-state')).toBe('error')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('网络异常')
    expect(banner.textContent).toContain('❌')
    expect(screen.getByTestId('drafting-banner-retry')).toBeInTheDocument()
    // 错误态不显示 ✕(决策 30 L3:失败必须可重试,而非被静默关闭)
    expect(screen.queryByTestId('drafting-banner-close')).toBeNull()
  })

  it('点 [重试] → onRequestAttach("banner-retry") + onRetry 都被调用', async () => {
    const { onRequestAttach, onRetry } = renderBanner({
      state: 'error',
      errorMessage: '鉴权失败',
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-banner-retry'))
    expect(onRequestAttach).toHaveBeenCalledWith('banner-retry')
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('errorMessage 缺省 → 显示兜底文案 "创建失败,请重试"', () => {
    renderBanner({ state: 'error' })
    expect(screen.getByTestId('drafting-banner').textContent).toContain(
      '创建失败,请重试',
    )
  })
})