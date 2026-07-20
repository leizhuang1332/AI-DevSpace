import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { RepoBar } from '../repo-bar'
import type { DraftingRepo } from '@/lib/drafting'

// ============================================================================
// Fixture
// ============================================================================

const REPOS: DraftingRepo[] = [
  { id: 'r1', name: 'refund-service' },
  { id: 'r2', name: 'order-service' },
  { id: 'r3', name: 'coupon-service' },
  { id: 'r-more', name: '＋ 更多仓库…' }, // 占位
]

function renderRepoBar(
  override: Partial<Parameters<typeof RepoBar>[0]> = {},
) {
  const defaultProps = {
    repos: REPOS,
    selectedRepoIds: ['r1', 'r2'],
    onDetachRepo: vi.fn(),
    canLaunch: true,
    onLaunch: vi.fn(),
    onRequestAttach: vi.fn(),
  }
  const props = { ...defaultProps, ...override }
  const utils = render(<RepoBar {...props} />)
  return { ...utils, props }
}

// ============================================================================
// N=0 空态(issue 09 Q9 · 沿用 issue 01 ticket 视觉)
// ============================================================================

describe('RepoBar · N=0 空态(issue 09 Q9 沿用 issue 01 ticket)', () => {
  afterEach(() => cleanup())

  it('renders N=0 empty state when selectedRepoIds is empty', () => {
    renderRepoBar({ selectedRepoIds: [] })
    // 走 N=0 空态:repo-bar-empty + repo-bar-add + repo-bar-empty-hint
    expect(screen.getByTestId('repo-bar-empty')).toBeInTheDocument()
    expect(screen.getByTestId('repo-bar-add')).toBeInTheDocument()
    expect(screen.getByTestId('repo-bar-empty-hint')).toBeInTheDocument()
    // 软警告在 N=0 也常驻(issue 08 验收 #4,issue 09 保留)
    expect(screen.getByTestId('drafting-repo-soft-warning')).toBeInTheDocument()
    // 不渲染摘要 / 展开区
    expect(screen.queryByTestId('drafting-repo-bar-summary')).toBeNull()
    expect(screen.queryByTestId('drafting-repo-bar-chips')).toBeNull()
    // data-empty-state=true
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-empty-state')).toBe('true')
    expect(bar.getAttribute('data-selected-count')).toBe('0')
  })

  it('N=0 状态下点击 ＋ 添加仓库 触发 onRequestAttach', async () => {
    const onRequestAttach = vi.fn()
    renderRepoBar({ selectedRepoIds: [], onRequestAttach })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('repo-bar-add'))
    expect(onRequestAttach).toHaveBeenCalledTimes(1)
  })

  it('N=0 软警告文案包含 ⚠ 仅 0 个仓库', () => {
    renderRepoBar({ selectedRepoIds: [] })
    const warn = screen.getByTestId('drafting-repo-soft-warning')
    expect(warn.textContent).toContain('⚠ 仅 0 个仓库')
    expect(warn.textContent).toContain('ANALYZING 可能无法完整关联代码上下文')
  })
})

// ============================================================================
// N≥1 折叠态(issue 09 Q2 方案 B · 默认 40px)
// ============================================================================

describe('RepoBar · N≥1 折叠态(issue 09 Q2 方案 B)', () => {
  afterEach(() => cleanup())

  it('默认折叠:渲染摘要 + 软警告 + ＋追加 + Launch', () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-collapsed')).toBe('true')
    expect(bar.getAttribute('data-empty-state')).toBe('false')

    // 摘要 + 追加 + 软警告 + 启动都在
    expect(screen.getByTestId('drafting-repo-bar-summary')).toBeInTheDocument()
    expect(screen.getByTestId('repo-bar-add-more')).toBeInTheDocument()
    // N=2 软警告隐藏
    expect(screen.queryByTestId('drafting-repo-soft-warning')).toBeNull()
    // 展开区不在
    expect(screen.queryByTestId('drafting-repo-bar-chips')).toBeNull()
  })

  it('折叠态不渲染 chip(默认隐藏)', () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    expect(screen.queryByTestId('drafting-repo-chip')).toBeNull()
  })

  it('折叠态不渲染 × detach 按钮(× 只在展开态)', () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    expect(screen.queryByTestId('drafting-repo-chip-detach')).toBeNull()
  })

  it('点击 ▾ 摘要 → 切换为展开态(data-collapsed=false)', async () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    const user = userEvent.setup()
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-collapsed')).toBe('true')

    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    expect(bar.getAttribute('data-collapsed')).toBe('false')
    // 展开后 chip 出现
    expect(screen.getAllByTestId('drafting-repo-chip')).toHaveLength(2)
  })

  it('摘要按钮有 aria-expanded 反映 collapsed 状态', async () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    const summary = screen.getByTestId('drafting-repo-bar-summary')
    expect(summary.getAttribute('aria-expanded')).toBe('false')

    const user = userEvent.setup()
    await user.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('true')
  })

  it('摘要标签动态显示已选数量', () => {
    renderRepoBar({ selectedRepoIds: ['r1'] })
    expect(screen.getByTestId('drafting-repo-bar-summary').textContent).toContain('已选 1 个仓库')

    cleanup()
    renderRepoBar({ selectedRepoIds: ['r1', 'r2', 'r3'] })
    expect(screen.getByTestId('drafting-repo-bar-summary').textContent).toContain('已选 3 个仓库')
  })
})

// ============================================================================
// 展开态:× 取消关联(issue 09 Q1 + Q4 + Q6)
// ============================================================================

describe('RepoBar · 展开态 × 取消关联(issue 09 Q4 一键生效)', () => {
  afterEach(() => cleanup())

  it('展开态:每个已选 chip 都有 × 按钮', async () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const detachButtons = screen.getAllByTestId('drafting-repo-chip-detach')
    expect(detachButtons).toHaveLength(2)
    expect(detachButtons[0].getAttribute('data-repo-id')).toBe('r1')
    expect(detachButtons[1].getAttribute('data-repo-id')).toBe('r2')
  })

  it('点 × 立即调用 onDetachRepo 传对应 repoId', async () => {
    const onDetachRepo = vi.fn()
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'], onDetachRepo })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))

    const r2Detach = screen
      .getAllByTestId('drafting-repo-chip-detach')
      .find((b) => b.getAttribute('data-repo-id') === 'r2') as HTMLElement
    await user.click(r2Detach)

    expect(onDetachRepo).toHaveBeenCalledTimes(1)
    expect(onDetachRepo).toHaveBeenCalledWith('r2')
  })

  it('× 按钮有 aria-label 含仓库名(无障碍)', async () => {
    renderRepoBar({ selectedRepoIds: ['r1'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const detach = screen.getByTestId('drafting-repo-chip-detach')
    expect(detach.getAttribute('aria-label')).toBe('取消关联 refund-service')
  })

  it('从 N=1 点 × → onDetachRepo 传正确 id(父组件负责 transition)', async () => {
    const onDetachRepo = vi.fn()
    renderRepoBar({
      selectedRepoIds: ['r1'],
      onDetachRepo,
    })
    const user = userEvent.setup()

    // 展开
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    // 点 ×
    await user.click(screen.getByTestId('drafting-repo-chip-detach'))
    // onDetachRepo 被调用 1 次,传 'r1'
    expect(onDetachRepo).toHaveBeenCalledTimes(1)
    expect(onDetachRepo).toHaveBeenCalledWith('r1')
    // 父组件(DraftingZone)拿到回调后负责 setSelectedRepoIds 然后 re-render;
    // 这个 transition 在 drafting-zone.test.tsx 的「集成测试」里覆盖
  })

  it('占位条目(以 ＋ 开头)不作为 chip 渲染(issue 01 ticket 取代)', async () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r-more'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const chips = screen.getAllByTestId('drafting-repo-chip')
    // r-more 被过滤,只剩 r1
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('data-repo-id')).toBe('r1')
  })
})

// ============================================================================
// 软警告(issue 09 Q7 · 折叠态外层常驻 + 展开态保留)
// ============================================================================

describe('RepoBar · 软警告(issue 09 Q7)', () => {
  afterEach(() => cleanup())

  it('N=1 折叠态:软警告可见', () => {
    renderRepoBar({ selectedRepoIds: ['r1'] })
    const warn = screen.getByTestId('drafting-repo-soft-warning')
    expect(warn.textContent).toContain('⚠ 仅 1 个仓库')
  })

  it('N=2 折叠态:软警告隐藏(issue 08 验收 #5)', () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2'] })
    expect(screen.queryByTestId('drafting-repo-soft-warning')).toBeNull()
  })

  it('N=1 展开态:展开区下方也保留软警告', async () => {
    renderRepoBar({ selectedRepoIds: ['r1'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    // 折叠行 + 展开区各一份
    const warnings = screen.getAllByTestId('drafting-repo-soft-warning')
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// failedRepoIds 兼容(ticket 02 验收 #8 回归)
// ============================================================================

describe('RepoBar · 失败 chip 兼容(ticket 02 验收 #8 回归)', () => {
  afterEach(() => cleanup())

  it('展开态:failedRepoIds 中的 repo 渲染为红边 ✕ chip', async () => {
    renderRepoBar({
      selectedRepoIds: ['r1'],
      failedRepoIds: ['r2'],
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const chips = screen.getAllByTestId('drafting-repo-chip')
    const r2 = chips.find((c) => c.getAttribute('data-repo-id') === 'r2')
    expect(r2).toBeDefined()
    expect(r2!.getAttribute('data-failed')).toBe('true')
    expect(r2!.getAttribute('data-selected')).toBe('false')
    expect(r2!.textContent).toContain('✕')
  })
})

// ============================================================================
// 非耦合(issue 08 验收 #7 #8 · launch 与仓库数无关)
// ============================================================================

describe('RepoBar · launch 与仓库数解耦(issue 08 验收 #7 #8)', () => {
  afterEach(() => cleanup())

  it('canLaunch=false 但 N=3 → launch 按钮 disabled,软警告隐藏', () => {
    renderRepoBar({ selectedRepoIds: ['r1', 'r2', 'r3'], canLaunch: false })
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn).toBeDisabled()
    expect(screen.queryByTestId('drafting-repo-soft-warning')).toBeNull()
  })

  it('canLaunch=true 但 N=0 → launch 按钮 enabled(警告存在但不影响)', () => {
    renderRepoBar({ selectedRepoIds: [], canLaunch: true })
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn).toBeEnabled()
    // 软警告显示但 launch 不受影响
    expect(screen.getByTestId('drafting-repo-soft-warning')).toBeInTheDocument()
  })
})

// ============================================================================
// 视觉(issue 08 验收 #8 · 关键 class 与 design 一致)
// ============================================================================

describe('RepoBar · 视觉基线(issue 08 验收 #8)', () => {
  afterEach(() => cleanup())

  it('bar 是 sticky bottom(issue 08 验收 #3)', () => {
    renderRepoBar()
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('bottom-0')
    expect(bar.className).toContain('border-t')
    expect(bar.className).toContain('bg-bg-elevated')
  })

  it('bar 有 role=region 和 aria-label', () => {
    renderRepoBar()
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('role')).toBe('region')
    expect(bar.getAttribute('aria-label')).toBe('仓库选择与启动操作')
  })
})
