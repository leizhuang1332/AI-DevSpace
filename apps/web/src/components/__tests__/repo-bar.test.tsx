import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { RepoBar } from '../repo-bar'
import type { DraftingRepo } from '@/lib/drafting'

// ============================================================================
// Fixture
// ============================================================================
//
// issue 06 (ADR-0030 D3 / 决策 105):
// - repo 字段从 `{ id, name }` 改为 `{ name, gitUrl, description }`
// - 删除 "＋ 更多仓库…" 占位 —— repos 列表全部是真实仓库,
//   name 即标识(全局唯一,无 `repo-` 前缀)

const REPOS: DraftingRepo[] = [
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
    name: 'coupon-service',
    gitUrl: 'https://example.com/coupon-service.git',
    description: '卡券服务',
  },
]

function renderRepoBar(
  override: Partial<Parameters<typeof RepoBar>[0]> = {},
) {
  const defaultProps = {
    repos: REPOS,
    selectedRepoNames: ['refund-service', 'order-service'],
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

  it('renders N=0 empty state when selectedRepoNames is empty', () => {
    renderRepoBar({ selectedRepoNames: [] })
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
    renderRepoBar({ selectedRepoNames: [], onRequestAttach })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('repo-bar-add'))
    expect(onRequestAttach).toHaveBeenCalledTimes(1)
  })

  it('N=0 软警告文案包含 ⚠ 仅 0 个仓库', () => {
    renderRepoBar({ selectedRepoNames: [] })
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
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
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
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
    expect(screen.queryByTestId('drafting-repo-chip')).toBeNull()
  })

  it('折叠态不渲染 × detach 按钮(× 只在展开态)', () => {
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
    expect(screen.queryByTestId('drafting-repo-chip-detach')).toBeNull()
  })

  it('点击 ▾ 摘要 → 切换为展开态(data-collapsed=false)', async () => {
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
    const user = userEvent.setup()
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-collapsed')).toBe('true')

    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    expect(bar.getAttribute('data-collapsed')).toBe('false')
    // 展开后 chip 出现
    expect(screen.getAllByTestId('drafting-repo-chip')).toHaveLength(2)
  })

  it('摘要按钮有 aria-expanded 反映 collapsed 状态', async () => {
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
    const summary = screen.getByTestId('drafting-repo-bar-summary')
    expect(summary.getAttribute('aria-expanded')).toBe('false')

    const user = userEvent.setup()
    await user.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('true')
  })

  it('摘要标签动态显示已选数量', () => {
    renderRepoBar({ selectedRepoNames: ['refund-service'] })
    expect(screen.getByTestId('drafting-repo-bar-summary').textContent).toContain('已选 1 个仓库')

    cleanup()
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service', 'coupon-service'] })
    expect(screen.getByTestId('drafting-repo-bar-summary').textContent).toContain('已选 3 个仓库')
  })
})

// ============================================================================
// 展开态:× 取消关联(issue 09 Q1 + Q4 + Q6)
// ============================================================================

describe('RepoBar · 展开态 × 取消关联(issue 09 Q4 一键生效)', () => {
  afterEach(() => cleanup())

  it('展开态:每个已选 chip 都有 × 按钮(data 属性用 name,无 id)', async () => {
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const detachButtons = screen.getAllByTestId('drafting-repo-chip-detach')
    expect(detachButtons).toHaveLength(2)
    // 字段切到 data-repo-name(issue 06)
    expect(detachButtons[0].getAttribute('data-repo-name')).toBe('refund-service')
    expect(detachButtons[1].getAttribute('data-repo-name')).toBe('order-service')
    // 不再有 data-repo-id
    detachButtons.forEach((b) => expect(b.getAttribute('data-repo-id')).toBeNull())
  })

  it('点 × 立即调用 onDetachRepo 传对应 repoName(issue 06 字段从 id 改为 name)', async () => {
    const onDetachRepo = vi.fn()
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'], onDetachRepo })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))

    const orderDetach = screen
      .getAllByTestId('drafting-repo-chip-detach')
      .find((b) => b.getAttribute('data-repo-name') === 'order-service') as HTMLElement
    await user.click(orderDetach)

    expect(onDetachRepo).toHaveBeenCalledTimes(1)
    expect(onDetachRepo).toHaveBeenCalledWith('order-service')
  })

  it('× 按钮有 aria-label 含仓库名(无障碍)', async () => {
    renderRepoBar({ selectedRepoNames: ['refund-service'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const detach = screen.getByTestId('drafting-repo-chip-detach')
    expect(detach.getAttribute('aria-label')).toBe('取消关联 refund-service')
  })

  it('从 N=1 点 × → onDetachRepo 传对应 repoName(父组件负责 transition)', async () => {
    const onDetachRepo = vi.fn()
    renderRepoBar({
      selectedRepoNames: ['refund-service'],
      onDetachRepo,
    })
    const user = userEvent.setup()

    // 展开
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    // 点 ×
    await user.click(screen.getByTestId('drafting-repo-chip-detach'))
    // onDetachRepo 被调用 1 次,传 'refund-service'(不是 id)
    expect(onDetachRepo).toHaveBeenCalledTimes(1)
    expect(onDetachRepo).toHaveBeenCalledWith('refund-service')
    // 父组件(DraftingZone)拿到回调后负责 setSelectedRepoNames 然后 re-render;
    // 这个 transition 在 drafting-zone.test.tsx 的「集成测试」里覆盖
  })

  // issue 06 ticket:删除 PLACEHOLDER_PREFIX 过滤逻辑
  it('issue 06:repos 列表全是真实仓库(name 即标识)—— 不再有 "＋ 更多仓库…" 占位', () => {
    renderRepoBar()
    // 渲染摘要里"已选 N 个仓库" = 选中的 2 个;没有多余的占位 chip
    expect(screen.getByTestId('drafting-repo-bar-summary').textContent).toContain('已选 2 个仓库')
    // data-repo-count === REPOS.length(没有额外占位条目)
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-repo-count')).toBe(String(REPOS.length))
    expect(bar.getAttribute('data-repo-count')).toBe('3')
  })
})

// ============================================================================
// 软警告(issue 09 Q7 · 折叠态外层常驻 + 展开态保留)
// ============================================================================

describe('RepoBar · 软警告(issue 09 Q7)', () => {
  afterEach(() => cleanup())

  it('N=1 折叠态:软警告可见', () => {
    renderRepoBar({ selectedRepoNames: ['refund-service'] })
    const warn = screen.getByTestId('drafting-repo-soft-warning')
    expect(warn.textContent).toContain('⚠ 仅 1 个仓库')
  })

  it('N=2 折叠态:软警告隐藏(issue 08 验收 #5)', () => {
    renderRepoBar({ selectedRepoNames: ['refund-service', 'order-service'] })
    expect(screen.queryByTestId('drafting-repo-soft-warning')).toBeNull()
  })

  it('N=1 展开态:展开区下方也保留软警告', async () => {
    renderRepoBar({ selectedRepoNames: ['refund-service'] })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    // 折叠行 + 展开区各一份
    const warnings = screen.getAllByTestId('drafting-repo-soft-warning')
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// failedRepoNames 兼容(ticket 02 验收 #8 回归 · 字段跟改 issue 06)
// ============================================================================

describe('RepoBar · 失败 chip 兼容(ticket 02 验收 #8 回归)', () => {
  afterEach(() => cleanup())

  it('展开态:failedRepoNames 中的 repo 渲染为红边 ✕ chip(data 属性用 name)', async () => {
    renderRepoBar({
      selectedRepoNames: ['refund-service'],
      failedRepoNames: ['order-service'],
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-repo-bar-summary'))
    const chips = screen.getAllByTestId('drafting-repo-chip')
    const order = chips.find((c) => c.getAttribute('data-repo-name') === 'order-service')
    expect(order).toBeDefined()
    expect(order!.getAttribute('data-failed')).toBe('true')
    expect(order!.getAttribute('data-selected')).toBe('false')
    expect(order!.textContent).toContain('✕')
    // 不再有 data-repo-id
    expect(order!.getAttribute('data-repo-id')).toBeNull()
  })
})

// ============================================================================
// 启动按钮已移除(launch 入口迁到 PRD 主文档 / Toolbar)
// ============================================================================

describe('RepoBar · 启动按钮已移除(后续 issue 迁移)', () => {
  afterEach(() => cleanup())

  it('N=3 canLaunch=false → 不渲染启动按钮 + 软警告隐藏', () => {
    renderRepoBar({
      selectedRepoNames: ['refund-service', 'order-service', 'coupon-service'],
      canLaunch: false,
    })
    // 启动按钮已不在 RepoBar 渲染(接口 canLaunch/onLaunch/launchDisabledHint 仍保留)
    expect(screen.queryByTestId('drafting-action-launch')).toBeNull()
    expect(screen.queryByTestId('drafting-launch-disabled-hint')).toBeNull()
    // 软警告隐藏(N≥2)
    expect(screen.queryByTestId('drafting-repo-soft-warning')).toBeNull()
  })

  it('N=0 canLaunch=true → 不渲染启动按钮 + 软警告仍显示', () => {
    renderRepoBar({ selectedRepoNames: [], canLaunch: true })
    // 启动按钮不在 RepoBar 渲染
    expect(screen.queryByTestId('drafting-action-launch')).toBeNull()
    expect(screen.queryByTestId('drafting-launch-disabled-hint')).toBeNull()
    // 软警告 N=0 仍显示(issue 08 验收 #4)
    expect(screen.getByTestId('drafting-repo-soft-warning')).toBeInTheDocument()
  })

  it('data-can-launch 契约仍保留(后续 toolbar / PRD 内可读)', () => {
    renderRepoBar({ selectedRepoNames: ['refund-service'], canLaunch: true })
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-can-launch')).toBe('true')
  })
})

// ============================================================================
// 视觉(issue 08 验收 #8 · 关键 class 与 design 一致)
// ============================================================================

describe('RepoBar · 视觉基线(issue 08 验收 #8)', () => {
  afterEach(() => cleanup())

  it('bar 是 sticky top + 边框与 PRD 同色同粗但改虚线(issue 08 验收 #3)', () => {
    renderRepoBar()
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('top-0')
    // 边框与 PRD 卡片(drafting-prd-pane)样式一致:同色 + 同粗(1px border),
    // 但改用虚线 border-dashed,与 PRD 实线卡片在视觉上区分
    expect(bar.className).toContain('border')
    expect(bar.className).toContain('border-dashed')
    expect(bar.className).toContain('border-border')
    expect(bar.className).toContain('bg-bg-elevated')
  })

  it('bar 有 role=region 和 aria-label', () => {
    renderRepoBar()
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('role')).toBe('region')
    expect(bar.getAttribute('aria-label')).toBe('仓库选择与启动操作')
  })
})