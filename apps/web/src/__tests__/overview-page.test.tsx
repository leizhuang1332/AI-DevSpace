import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// next/link 在 jsdom 里简化渲染,避免 next 内部 router 上下文报错
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { OverviewPage } from '@/components/overview-page'
import {
  emptyOverview,
  getRequirementOverview,
  type OverviewData,
} from '@/lib/requirement-overview'

afterEach(() => cleanup())

// ============================================================================
// 满数据渲染 — 5 项内容 + banner
// ============================================================================

const FULL_DATA: OverviewData = {
  requirementId: 'REF-001',
  empty: false,
  meta: {
    title: '退款功能优化',
    reqIdLabel: 'REF-2024-089',
    status: 'implementing',
    repos: ['refund-service', 'order-core', 'payment-gateway'],
    owner: '@ray',
    createdAt: '2026-07-08 · 4 天前',
    updatedAt: '12 分钟前',
  },
  progress: {
    percent: 72,
    total: 12,
    done: 7,
    inProgress: 1,
    waiting: 1,
    todo: 3,
    codeLinesAdded: 110,
    codeLinesRemoved: 20,
    artifactCount: 5,
    prStatus: 'PR #234 等待 review',
  },
  zoneCards: [
    { zoneId: 'drafting', caption: 'PRD 已写', meta: '3 节', state: 'done' },
    { zoneId: 'analyzing', caption: '已完成', meta: '5 子问题', state: 'done' },
    { zoneId: 'clarifying', caption: '已澄清', meta: '3 轮', state: 'done' },
    { zoneId: 'designing', caption: '方案 A 已选', meta: '3 候选', state: 'done' },
    { zoneId: 'executing', caption: '当前进度', meta: '1/4 任务', state: 'cur' },
    { zoneId: 'wrapup', caption: '待归档', meta: '—', state: 'todo' },
  ],
  milestones: [
    { id: 'drafting', name: 'DRAFTING · 写 PRD', ts: '2026-07-08', sub: '完成需求文档 + AC 5 条', state: 'done' },
    { id: 'analyzing', name: 'ANALYZING · AI 分析', ts: '2026-07-09', sub: '识别子问题 5 个', state: 'done' },
    { id: 'clarifying', name: 'CLARIFYING · 澄清', ts: '2026-07-09 → 07-10', sub: '3 轮问答', state: 'done' },
    { id: 'designing', name: 'DESIGNING · 选方案', ts: '2026-07-10', sub: '选择方案 A', state: 'done' },
    { id: 'planning', name: 'PLANNING · 任务拆分', ts: '2026-07-11', sub: '12 个任务', state: 'done' },
    { id: 'executing', name: 'EXECUTING · 实施中', ts: '2026-07-11 → 进行中', sub: '已完成 7/12 任务', state: 'cur' },
    { id: 'wrapup', name: 'WRAP-UP · 归档', ts: null, sub: '待 EXECUTING 完成后归档', state: 'todo' },
  ],
  aiActivity: {
    totalActiveMinutes: 83,
    totalLinesWritten: 124,
    skillCalls: 23,
    snapshotCount: 7,
    zones: [
      { zoneId: 'executing', percent: 78 },
      { zoneId: 'designing', percent: 42 },
      { zoneId: 'clarifying', percent: 28 },
      { zoneId: 'analyzing', percent: 18 },
      { zoneId: 'drafting', percent: 12 },
    ],
  },
}

// ============================================================================
// 渲染测试 — 满数据
// ============================================================================

describe('OverviewPage · 满数据', () => {
  it('渲染 5 项内容卡片 + 顶部 banner', () => {
    render(<OverviewPage data={FULL_DATA} />)

    // 主区根节点
    expect(screen.getByTestId('overview-page')).toBeInTheDocument()
    expect(
      screen.getByTestId('overview-page').getAttribute('data-empty'),
    ).toBe('false')
    expect(
      screen.getByTestId('overview-page').getAttribute('data-requirement-id'),
    ).toBe('REF-001')

    // 顶部 banner
    expect(screen.getByTestId('overview-header')).toBeInTheDocument()
    expect(screen.getByText('退款功能优化')).toBeInTheDocument()
    expect(screen.getByText('REF-2024-089')).toBeInTheDocument()

    // 5 项卡片
    expect(screen.getByTestId('overview-progress-card')).toBeInTheDocument()
    expect(screen.getByTestId('overview-zone-map-card')).toBeInTheDocument()
    expect(screen.getByTestId('overview-milestones-card')).toBeInTheDocument()
    expect(screen.getByTestId('overview-ai-card')).toBeInTheDocument()

    // 2x2 网格容器
    expect(screen.getByTestId('overview-grid')).toBeInTheDocument()
  })

  it('完成进度卡片:4 stat cell + 进度条 + 详情段', () => {
    render(<OverviewPage data={FULL_DATA} />)
    const stats = screen.getByTestId('overview-progress-stats')
    expect(stats.textContent).toContain('7')
    expect(stats.textContent).toContain('已完成')
    expect(stats.textContent).toContain('1')
    expect(stats.textContent).toContain('进行中')
    expect(stats.textContent).toContain('1')
    expect(stats.textContent).toContain('等待中')
    expect(stats.textContent).toContain('3')
    expect(stats.textContent).toContain('待办')

    const bar = screen.getByTestId('overview-progress-bar')
    expect(bar.getAttribute('data-percent')).toBe('72')

    const detail = screen.getByTestId('overview-progress-detail')
    expect(detail.textContent).toContain('代码 +110/-20 行')
    expect(detail.textContent).toContain('产物 5 件')
    expect(detail.textContent).toContain('PR #234 等待 review')
  })

  it('工位地图:6 工位卡片,点击跳对应工位(WRAP-UP → wrap-up/)', () => {
    render(<OverviewPage data={FULL_DATA} />)
    expect(screen.getByTestId('overview-zone-map').children.length).toBe(6)

    // 6 个工位都渲染
    for (const id of ['drafting', 'analyzing', 'clarifying', 'designing', 'executing', 'wrapup']) {
      expect(screen.getByTestId(`overview-zone-${id}`)).toBeInTheDocument()
    }

    // WRAP-UP 点击跳 /wrap-up/
    const wrapup = screen.getByTestId('overview-zone-wrapup')
    expect(wrapup.getAttribute('href')).toBe('/requirements/REF-001/wrap-up/')

    // EXECUTING 是当前 zone → state=cur
    const executing = screen.getByTestId('overview-zone-executing')
    expect(executing.getAttribute('data-zone-state')).toBe('cur')
    // EXECUTING 的 class 应含 brand-50 / brand 高亮
    expect(executing.className).toContain('bg-brand-50')

    // WRAP-UP 是 todo
    expect(wrapup.getAttribute('data-zone-state')).toBe('todo')
  })

  it('时间线:7 节点,当前 zone 高亮,已完成绿色', () => {
    render(<OverviewPage data={FULL_DATA} />)
    const timeline = screen.getByTestId('overview-timeline')
    expect(timeline.querySelectorAll('li').length).toBe(7)

    // EXECUTING 是当前节点(state=cur)
    const cur = screen.getByTestId('overview-milestone-executing')
    expect(cur.getAttribute('data-milestone-state')).toBe('cur')

    // DRAFTING / ANALYZING / CLARIFYING / DESIGNING / PLANNING 都是 done
    for (const id of ['drafting', 'analyzing', 'clarifying', 'designing', 'planning']) {
      expect(screen.getByTestId(`overview-milestone-${id}`).getAttribute('data-milestone-state')).toBe('done')
    }

    // WRAP-UP 是 todo
    expect(screen.getByTestId('overview-milestone-wrapup').getAttribute('data-milestone-state')).toBe('todo')
  })

  it('AI 活动概览:3 stat cell + 工位活跃度条', () => {
    render(<OverviewPage data={FULL_DATA} />)
    const stats = screen.getByTestId('overview-ai-stats')
    expect(stats.textContent).toContain('124')
    expect(stats.textContent).toContain('总写入行')
    expect(stats.textContent).toContain('23')
    expect(stats.textContent).toContain('Skill 调用')
    expect(stats.textContent).toContain('7')
    expect(stats.textContent).toContain('快照数')

    // 5 个工位活跃度
    expect(screen.getByTestId('overview-ai-zone-executing').getAttribute('data-percent')).toBe('78')
    expect(screen.getByTestId('overview-ai-zone-drafting').getAttribute('data-percent')).toBe('12')

    // 总活跃时间显示 1h 23min
    expect(screen.getByTestId('overview-ai-total').textContent).toContain('1h 23min')
  })

  it('顶部 banner 渲染元数据栏(状态 / 仓库 / 负责人 / 创建 / 更新)', () => {
    render(<OverviewPage data={FULL_DATA} />)
    const header = screen.getByTestId('overview-header')
    expect(header.textContent).toContain('IMPLEMENTING')
    expect(header.textContent).toContain('refund-service')
    expect(header.textContent).toContain('@ray')
    expect(header.textContent).toContain('2026-07-08 · 4 天前')
    expect(header.textContent).toContain('12 分钟前')

    // 状态色点存在
    const dot = screen.getByTestId('overview-status-dot')
    expect(dot.getAttribute('data-status')).toBe('implementing')
  })
})

// ============================================================================
// 空状态
// ============================================================================

describe('OverviewPage · 空数据', () => {
  it('empty=true 时渲染空状态引导,不渲染 5 项卡片', () => {
    const empty = emptyOverview('NEW-REQ')
    render(<OverviewPage data={empty} />)

    expect(screen.getByTestId('overview-page').getAttribute('data-empty')).toBe('true')
    expect(screen.getByText('暂无数据')).toBeInTheDocument()

    // 不渲染 5 项卡片
    expect(screen.queryByTestId('overview-grid')).toBeNull()
    expect(screen.queryByTestId('overview-progress-card')).toBeNull()
    expect(screen.queryByTestId('overview-zone-map-card')).toBeNull()
    expect(screen.queryByTestId('overview-milestones-card')).toBeNull()
    expect(screen.queryByTestId('overview-ai-card')).toBeNull()

    // CTA 引导去 DRAFTING
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.closest('a')?.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting/')
  })

  it('空数据时顶层不崩(挂载即返回)', () => {
    expect(() => render(<OverviewPage data={emptyOverview('X')} />)).not.toThrow()
  })
})

// ============================================================================
// 数据层 · getRequirementOverview
// ============================================================================

describe('getRequirementOverview', () => {
  it('已知 id(req-001)返回满数据', async () => {
    const data = await getRequirementOverview('req-001')
    expect(data.empty).toBe(false)
    expect(data.meta.title).toBe('退款功能优化')
    expect(data.zoneCards.length).toBe(6)
    expect(data.milestones.length).toBe(7)
  })

  it('未知 id 返回空状态', async () => {
    const data = await getRequirementOverview('unknown-id')
    expect(data.empty).toBe(true)
    expect(data.requirementId).toBe('unknown-id')
    expect(data.zoneCards).toEqual([])
    expect(data.milestones).toEqual([])
    expect(data.aiActivity.zones).toEqual([])
  })

  it('空数据时进度数字均为 0,无 PR', () => {
    const data = emptyOverview('X')
    expect(data.progress.percent).toBe(0)
    expect(data.progress.done).toBe(0)
    expect(data.progress.prStatus).toBeNull()
  })
})