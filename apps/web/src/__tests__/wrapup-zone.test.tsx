import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import {
  WrapupZone,
} from '@/components/wrapup-zone'
import {
  emptyWrapup,
  extractWrapupTreeSummary,
  getWrapupData,
} from '@/lib/wrapup'

afterEach(() => {
  cleanup()
})

// ============================================================================
// 满数据渲染 — Archive 形态(对应原型 11f)
// ============================================================================

describe('WrapupZone · 满数据渲染', () => {
  it('根节点 + stage strip + toolbar + 7 个 section 全部存在', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const root = screen.getByTestId('wrapup-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')
    expect(root.getAttribute('data-archived')).toBe('false')

    // Stage strip:⑥ 完成 + WRAP-UP · Archive
    expect(screen.getByTestId('wrapup-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-stage-badge').textContent).toBe(
      '⑥ 完成',
    )
    expect(
      screen.getByTestId('wrapup-stage-title').textContent,
    ).toContain('WRAP-UP')
    expect(
      screen.getByTestId('wrapup-stage-title').textContent,
    ).toContain('Archive')

    // Toolbar:面包屑 + 4 个动作按钮
    expect(screen.getByTestId('wrapup-toolbar')).toBeInTheDocument()
    const current = screen.getByTestId('wrapup-crumb-current')
    expect(current.textContent).toBe('回顾报告')
    expect(current.getAttribute('data-current')).toBe('true')

    // 7 个 section 全部存在
    expect(screen.getByTestId('wrapup-hero')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-ac-section')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-artifact-section')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-pr-section')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-decision-section')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-stats-footer')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-archive-actions')).toBeInTheDocument()
  })

  it('顶部回顾报告 hero:✓ + 起始/完成/耗时 + AC 通过 + AI% + 4 个统计数字', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const hero = screen.getByTestId('wrapup-hero')
    expect(within(hero).getByTestId('wrapup-hero-check').textContent).toBe(
      '✓',
    )
    const title = within(hero).getByTestId('wrapup-hero-title')
    expect(title.textContent).toContain('已完成')

    const desc = within(hero).getByTestId('wrapup-hero-desc')
    expect(desc.textContent).toContain('2026-07-08') // startDate
    expect(desc.textContent).toContain('2026-07-11') // endDate
    expect(desc.textContent).toContain('3 天 7 小时') // duration
    expect(desc.textContent).toContain('3/3 通过') // acPassRate
    expect(desc.textContent).toContain('89%') // aiPercent
    expect(desc.textContent).toContain('11 次') // manualInterventions

    // 4 个统计数字(代码行 / 删除 / 任务 / 测试用例)
    const stats = within(hero).getAllByTestId('wrapup-hero-stat')
    expect(stats.length).toBe(4)
    expect(stats[0].textContent).toContain('+847')
    expect(stats[1].textContent).toContain('-213')
    expect(stats[2].textContent).toContain('14')
    expect(stats[3].textContent).toContain('38')
  })

  it('AC 通过情况:3 项全部 passed=true,渲染 checked 状态 + 实测值', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const section = screen.getByTestId('wrapup-ac-section')
    expect(section.getAttribute('data-passed-count')).toBe('3')
    expect(section.getAttribute('data-total-count')).toBe('3')

    const items = within(section).getAllByTestId('wrapup-ac-item')
    expect(items.length).toBe(3)
    for (const item of items) {
      expect(item.getAttribute('data-passed')).toBe('true')
      expect(within(item).getByTestId('wrapup-ac-checkbox').textContent).toBe(
        '✓',
      )
    }

    // 标题文本包含关键 AC 名
    expect(within(section).getByText(/AC1 · 退款成功率/)).toBeInTheDocument()
    expect(within(section).getByText(/AC2 · 平均退款时长/)).toBeInTheDocument()
    expect(
      within(section).getByText(/AC3 · 退款失败时优惠券/),
    ).toBeInTheDocument()

    // 实测值 + 补充 metric
    const ac1 = items[0]
    expect(within(ac1).getByTestId('wrapup-ac-metrics').textContent).toContain(
      '99.4%',
    )
    expect(within(ac1).getByTestId('wrapup-ac-metrics').textContent).toContain(
      '1000 QPS',
    )
  })

  it('产物清单:6 张卡片,每张含类型 icon + 名称 + preview + status + 链接', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const section = screen.getByTestId('wrapup-artifact-section')
    expect(section.getAttribute('data-count')).toBe('6')

    const grid = within(section).getByTestId('wrapup-artifact-grid')
    const cards = within(grid).getAllByTestId('wrapup-artifact-card')
    expect(cards.length).toBe(6)

    for (const card of cards) {
      // 必含 href(可点击跳文件)
      expect(card.tagName).toBe('A')
      expect(card.getAttribute('href')).toBeTruthy()
      // type icon + name
      expect(within(card).getByTestId('wrapup-artifact-type')).toBeInTheDocument()
      expect(within(card).getByTestId('wrapup-artifact-name')).toBeInTheDocument()
      // preview + status
      expect(within(card).getByTestId('wrapup-artifact-preview')).toBeInTheDocument()
      expect(
        within(card).getByTestId('wrapup-artifact-card-status'),
      ).toBeInTheDocument()
      // date
      expect(within(card).getByTestId('wrapup-artifact-date')).toBeInTheDocument()
    }

    // 不同 kind → 不同 typeLabel
    const sql = cards.find((c) => c.getAttribute('data-kind') === 'sql')
    const api = cards.find((c) => c.getAttribute('data-kind') === 'api')
    const cfg = cards.find((c) => c.getAttribute('data-kind') === 'config')
    expect(within(sql!).getByTestId('wrapup-artifact-type').textContent).toBe(
      'SQL',
    )
    expect(within(api!).getByTestId('wrapup-artifact-type').textContent).toBe(
      'API',
    )
    expect(within(cfg!).getByTestId('wrapup-artifact-type').textContent).toBe(
      'CFG',
    )

    // status:6 张里 5 张 ok + 1 张 warn(apollo.yaml)
    const ok = cards.filter((c) => c.getAttribute('data-status') === 'ok')
    const warn = cards.filter((c) => c.getAttribute('data-status') === 'warn')
    expect(ok.length).toBe(5)
    expect(warn.length).toBe(1)
  })

  it('关联 PR:4 行,每行含 ✓ 状态 + 标题 + sha + 仓库 + +/- 统计 + 2 个动作链接', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const section = screen.getByTestId('wrapup-pr-section')
    expect(section.getAttribute('data-count')).toBe('4')

    const items = within(section).getAllByTestId('wrapup-pr-item')
    expect(items.length).toBe(4)

    const first = items[0]
    expect(first.getAttribute('data-sha')).toBe('a3f5b2c')
    expect(within(first).getByTestId('wrapup-pr-title').textContent).toContain(
      '实现退款查询接口',
    )
    expect(within(first).getByTestId('wrapup-pr-meta').textContent).toContain(
      'refund-service',
    )
    expect(within(first).getByTestId('wrapup-pr-meta').textContent).toContain(
      '+342',
    )
    expect(within(first).getByTestId('wrapup-pr-meta').textContent).toContain(
      '14 tests',
    )
    expect(within(first).getByTestId('wrapup-pr-diff').getAttribute('href')).toBe(
      '/diff/refund-service/a3f5b2c',
    )
    expect(within(first).getByTestId('wrapup-pr-open').getAttribute('href')).toBe(
      '/pr/refund-service/a3f5b2c',
    )
  })

  it('关键决策回顾:5 行,每行含 Q-id + 提问 + 采纳答案 + 耗时', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const section = screen.getByTestId('wrapup-decision-section')
    expect(section.getAttribute('data-count')).toBe('5')

    const rows = within(section).getAllByTestId('wrapup-decision-row')
    expect(rows.length).toBe(5)

    const q1 = rows[0]
    expect(q1.getAttribute('data-decision-id')).toBe('Q1')
    expect(within(q1).getByTestId('wrapup-decision-qid').textContent).toBe('Q1')
    expect(within(q1).getByTestId('wrapup-decision-question').textContent).toBe(
      '退款单笔金额上限?',
    )
    expect(within(q1).getByTestId('wrapup-decision-answer').textContent).toContain(
      '5000 元',
    )
    expect(within(q1).getByTestId('wrapup-decision-answer').textContent).toContain(
      '14m',
    )
  })

  it('底部统计:变更 4 项 + AI 活动 4 项,数字与 mock 一致', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    const footer = screen.getByTestId('wrapup-stats-footer')

    // 变更
    expect(within(footer).getByTestId('wrapup-changes-added').textContent).toContain(
      '+847',
    )
    expect(
      within(footer).getByTestId('wrapup-changes-removed').textContent,
    ).toContain('-213')
    expect(within(footer).getByTestId('wrapup-changes-files').textContent).toContain(
      '38',
    )
    expect(within(footer).getByTestId('wrapup-changes-repos').textContent).toContain(
      '2',
    )

    // AI 活动
    expect(within(footer).getByTestId('wrapup-ai-writes').textContent).toContain(
      '247',
    )
    expect(within(footer).getByTestId('wrapup-ai-thinking').textContent).toContain(
      '142m',
    )
    expect(
      within(footer).getByTestId('wrapup-ai-snapshots').textContent,
    ).toContain('6')
    expect(within(footer).getByTestId('wrapup-ai-skills').textContent).toContain(
      '23',
    )
  })

  it('ZoneBar WRAP-UP 灰点(status_color=gray · issue 22 验收)', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    // toolbar "形态" 标签体现 Archive
    expect(screen.getByTestId('wrapup-toolbar').textContent).toContain(
      'Archive',
    )

    // ZONE_STATUS_COLOR_CLASS.gray = 'bg-gray-400'(决策 22)
    const { ZONE_STATUS_COLOR_CLASS } = await import('@/lib/zones')
    expect(ZONE_STATUS_COLOR_CLASS.gray).toBe('bg-gray-400')

    const { ZONE_META } = await import('@/lib/zones')
    const wrapup = ZONE_META.find((z) => z.id === 'wrapup')
    expect(wrapup).toBeDefined()
    expect(wrapup!.status_color).toBe('gray')
  })
})

// ============================================================================
// 交互 — 归档 / 重新打开
// ============================================================================

describe('WrapupZone · Archive / Reopen 交互', () => {
  it('默认状态(data.archive.archived=false):显示 [📦 归档此需求] 按钮,无 [🔄 重新打开]', async () => {
    const data = await getWrapupData('req-001')
    render(<WrapupZone data={data} />)

    expect(screen.getByTestId('wrapup-zone').getAttribute('data-archived')).toBe(
      'false',
    )
    expect(screen.getByTestId('wrapup-archive')).toBeInTheDocument()
    expect(screen.queryByTestId('wrapup-reopen')).toBeNull()
  })

  it('点击 [📦 归档此需求] → 触发 onArchive + UI 切到 archived + 按钮消失', async () => {
    const data = await getWrapupData('req-001')
    const onArchive = vi.fn()
    render(<WrapupZone data={data} onArchive={onArchive} />)

    const archiveBtn = screen.getByTestId('wrapup-archive')
    fireEvent.click(archiveBtn)

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive.mock.calls[0][0]).toEqual({})

    // 切到 archived:true
    expect(screen.getByTestId('wrapup-zone').getAttribute('data-archived')).toBe(
      'true',
    )
    // [📦 归档此需求] 消失,[🔄 重新打开] 出现
    expect(screen.queryByTestId('wrapup-archive')).toBeNull()
    expect(screen.getByTestId('wrapup-reopen')).toBeInTheDocument()
    expect(screen.getByTestId('wrapup-archive-actions').textContent).toContain(
      '已归档',
    )
  })

  it('点击 [🔄 重新打开] → 触发 onReopen + UI 切回 archived=false', async () => {
    // 预设 archived:true
    const base = await getWrapupData('req-001')
    const data = { ...base, archive: { archived: true } }
    const onReopen = vi.fn()
    render(<WrapupZone data={data} onReopen={onReopen} />)

    // 初始就是 archived
    expect(screen.getByTestId('wrapup-zone').getAttribute('data-archived')).toBe(
      'true',
    )
    expect(screen.getByTestId('wrapup-reopen')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('wrapup-reopen'))

    expect(onReopen).toHaveBeenCalledTimes(1)
    expect(onReopen.mock.calls[0][0]).toEqual({ toZone: 'executing' })
    expect(screen.getByTestId('wrapup-zone').getAttribute('data-archived')).toBe(
      'false',
    )
    expect(screen.getByTestId('wrapup-archive')).toBeInTheDocument()
  })

  it('archive.archived=true 时,toolbar [📦 归档此需求] 按钮 disabled', async () => {
    const base = await getWrapupData('req-001')
    const data = { ...base, archive: { archived: true } }
    render(<WrapupZone data={data} />)

    const tb = screen.getByTestId('wrapup-toolbar-archive')
    expect(tb.hasAttribute('disabled')).toBe(true)
  })

  it('archived 态:跳转链接 [→ 跳到 EXECUTING] 指向 /requirements/<id>/executing', async () => {
    const base = await getWrapupData('req-001')
    const data = { ...base, archive: { archived: true } }
    render(<WrapupZone data={data} />)

    const link = screen.getByTestId('wrapup-archive-go-executing')
    expect(link.getAttribute('href')).toBe('/requirements/req-001/executing')
  })

  it('默认 no-op 回调(不传 onArchive / onReopen)点击不会抛错', async () => {
    const data = await getWrapupData('req-001')
    expect(() => render(<WrapupZone data={data} />)).not.toThrow()
    expect(() =>
      fireEvent.click(screen.getByTestId('wrapup-archive')),
    ).not.toThrow()
  })
})

// ============================================================================
// 资源树摘要(由 page.tsx 派生注入 ResourceTree)
// ============================================================================

describe('extractWrapupTreeSummary', () => {
  it('从 WrapupData 派生资源树摘要(artifactCount / prCount / decisionCount)', async () => {
    const data = await getWrapupData('req-001')
    const summary = extractWrapupTreeSummary(data)

    expect(summary.artifactCount).toBe(6)
    expect(summary.prCount).toBe(4)
    expect(summary.decisionCount).toBe(5)

    expect(summary.artifacts.length).toBe(6)
    expect(summary.prs.length).toBe(4)
    expect(summary.decisions.length).toBe(5)

    // 产物至少包含 refund.sql
    const refund = summary.artifacts.find((a) => a.name === 'refund.sql')
    expect(refund).toBeDefined()
    expect(refund!.status).toBe('ok')

    // PR 至少包含 a3f5b2c
    const pr1 = summary.prs.find((p) => p.sha === 'a3f5b2c')
    expect(pr1).toBeDefined()
    expect(pr1!.title).toContain('实现退款查询接口')

    // 决策至少包含 Q1
    const q1 = summary.decisions.find((d) => d.id === 'Q1')
    expect(q1).toBeDefined()
    expect(q1!.question).toBe('退款单笔金额上限?')
  })

  it('空数据派生空 summary(全 0 / 空数组)', () => {
    const data = emptyWrapup('NEW')
    const summary = extractWrapupTreeSummary(data)

    expect(summary.artifactCount).toBe(0)
    expect(summary.prCount).toBe(0)
    expect(summary.decisionCount).toBe(0)
    expect(summary.artifacts).toEqual([])
    expect(summary.prs).toEqual([])
    expect(summary.decisions).toEqual([])
  })
})

// ============================================================================
// 空数据 — 引导去 EXECUTING
// ============================================================================

describe('WrapupZone · 空数据', () => {
  it('empty=true 渲染空态引导,所有 section 都不渲染', () => {
    const data = emptyWrapup('NEW-REQ')
    render(<WrapupZone data={data} />)

    const root = screen.getByTestId('wrapup-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    expect(screen.getByText('WRAP-UP 工位暂无可归档内容')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 EXECUTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/executing')

    // 7 个 section 都 query 不出
    expect(screen.queryByTestId('wrapup-hero')).toBeNull()
    expect(screen.queryByTestId('wrapup-ac-section')).toBeNull()
    expect(screen.queryByTestId('wrapup-artifact-section')).toBeNull()
    expect(screen.queryByTestId('wrapup-pr-section')).toBeNull()
    expect(screen.queryByTestId('wrapup-decision-section')).toBeNull()
    expect(screen.queryByTestId('wrapup-stats-footer')).toBeNull()
    expect(screen.queryByTestId('wrapup-archive-actions')).toBeNull()
  })

  it('未知 id → getWrapupData 返回 emptyWrapup', async () => {
    const data = await getWrapupData('UNKNOWN-ID')
    expect(data.empty).toBe(true)
    expect(data.requirementId).toBe('UNKNOWN-ID')
  })
})

// ============================================================================
// 边界
// ============================================================================

describe('WrapupZone · 边界', () => {
  it('顶层不崩(empty mount 即返回)', () => {
    expect(() =>
      render(<WrapupZone data={emptyWrapup('X')} />),
    ).not.toThrow()
  })

  it('空数组下渲染空 section(无 AC / 无 PR / 无决策)', () => {
    const base = emptyWrapup('X')
    const data = {
      ...base,
      empty: false,
      stage: { badge: '⑥ 完成', title: 't', meta: 'm' },
      toolbar: { crumb: [{ label: 'x', current: true }] },
    }
    render(<WrapupZone data={data} />)

    expect(screen.getByTestId('wrapup-ac-section').getAttribute('data-total-count')).toBe(
      '0',
    )
    expect(
      screen.getByTestId('wrapup-artifact-section').getAttribute('data-count'),
    ).toBe('0')
    expect(screen.getByTestId('wrapup-pr-section').getAttribute('data-count')).toBe(
      '0',
    )
    expect(
      screen.getByTestId('wrapup-decision-section').getAttribute('data-count'),
    ).toBe('0')
  })
})
