import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { ExecutingZone } from '@/components/executing-zone'
import {
  emptyExecuting,
  getExecutingData,
  type ExecutingData,
} from '@/lib/executing'

afterEach(() => cleanup())

// ============================================================================
// 满数据渲染 — 三列 Mission Control 布局
// ============================================================================

describe('ExecutingZone · 满数据渲染', () => {
  it('根节点 + 三列布局容器存在', async () => {
    const data = await getExecutingData('req-001')
    render(<ExecutingZone data={data} />)

    const root = screen.getByTestId('executing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')

    // 三列容器
    const mc = screen.getByTestId('executing-mc-main')
    expect(mc.className).toContain('grid-cols-[280px_1fr_320px]')

    // 三列都渲染
    expect(screen.getByTestId('executing-dag-col')).toBeInTheDocument()
    expect(screen.getByTestId('executing-diff-col')).toBeInTheDocument()
    expect(screen.getByTestId('executing-ai-col')).toBeInTheDocument()
  })

  it('顶部 stage strip + toolbar 渲染', async () => {
    const data = await getExecutingData('req-001')
    render(<ExecutingZone data={data} />)

    // stage strip
    const stage = screen.getByTestId('executing-stage-strip')
    expect(stage).toBeInTheDocument()
    expect(screen.getByTestId('executing-stage-badge').textContent).toBe('⑤ 编码')
    expect(screen.getByTestId('executing-stage-title').textContent).toContain(
      'IMPLEMENTING',
    )
    expect(screen.getByTestId('executing-stage-title').textContent).toContain(
      'Mission Control',
    )

    const meta = screen.getByTestId('executing-stage-meta').textContent
    expect(meta).toContain('7/14 tasks')
    expect(meta).toContain('60% 完成')
    expect(meta).toContain('⏸ 1 阻塞')

    // toolbar
    expect(screen.getByTestId('executing-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('executing-toolbar-crumb')).toBeInTheDocument()
    // 5 段面包屑(3 文本 + 2 分隔符)
    const crumbs = screen.getAllByTestId(/^executing-crumb/)
    expect(crumbs.length).toBe(5)
    // current 项
    const current = screen.getByTestId('executing-crumb-current')
    expect(current.textContent).toBe('Mission Control')
    expect(current.getAttribute('data-current')).toBe('true')

    // spec 验收:3 个动作按钮(暂停 AI / 设置 / 中止)
    const actions = screen.getAllByTestId('executing-toolbar-action')
    expect(actions.length).toBe(3)
    const labels = actions.map((a) => a.textContent)
    expect(labels.some((l) => l?.includes('暂停 AI'))).toBe(true)
    expect(labels.some((l) => l?.includes('设置'))).toBe(true)
    expect(labels.some((l) => l?.includes('中止'))).toBe(true)
    // 中止是 danger 变体
    const dangerAction = actions.find(
      (a) => a.getAttribute('data-variant') === 'danger',
    )
    expect(dangerAction?.textContent).toContain('中止')
  })

  it('DAG 列:4 状态 stats + 任务卡片', async () => {
    const data = await getExecutingData('req-001')
    render(<ExecutingZone data={data} />)

    // stats 4 cell,每个 n 与 mock 一致
    expect(screen.getByTestId('executing-dag-stat-done').getAttribute('data-n')).toBe('2')
    expect(screen.getByTestId('executing-dag-stat-doing').getAttribute('data-n')).toBe('1')
    expect(screen.getByTestId('executing-dag-stat-wait').getAttribute('data-n')).toBe('1')
    expect(screen.getByTestId('executing-dag-stat-todo').getAttribute('data-n')).toBe('1')

    // 任务卡片 5 个,各 status
    const tasks = screen.getAllByTestId('executing-dag-task')
    expect(tasks.length).toBe(5)
    const statuses = tasks.map((t) => t.getAttribute('data-task-status'))
    expect(statuses).toEqual(['done', 'done', 'doing', 'wait', 'todo'])

    // spec 验收 #4: 资源树任务节点可点击跳任务详情 → DAG 卡片都带 href link
    const taskLinks = screen.getAllByTestId('executing-dag-task-link')
    expect(taskLinks.length).toBe(5)
    expect(taskLinks[0].getAttribute('href')).toBe('?task=T-1')
    expect(taskLinks[2].getAttribute('href')).toBe('?task=T-7') // doing task

    // 状态色:done → success,doing → brand ring,wait → warning,todo → 灰
    // 卡片外层 <li> + 内层 <Link>,className 在内层 Link 上
    const doingLi = tasks.find(
      (t) => t.getAttribute('data-task-status') === 'doing',
    )!
    const doingLink = doingLi.querySelector('a')!
    expect(doingLink.className).toContain('border-brand')
    expect(doingLink.className).toContain('bg-brand-50')

    const todoLi = tasks.find(
      (t) => t.getAttribute('data-task-status') === 'todo',
    )!
    const todoLink = todoLi.querySelector('a')!
    expect(todoLink.className).toContain('text-text-3')

    // meta 显示 4 状态汇总
    expect(screen.getByTestId('executing-dag-meta').textContent).toContain(
      '7/14',
    )
  })

  it('Diff 列:filter tabs + 文件级 diff(+/- 行高亮)', async () => {
    const data = await getExecutingData('req-001')
    render(<ExecutingZone data={data} />)

    // 4 个筛选 tab,默认 all active
    expect(screen.getByTestId('executing-diff-filter-all').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('executing-diff-filter-mod').getAttribute('data-active')).toBe('false')
    expect(screen.getByTestId('executing-diff-filter-add').getAttribute('data-active')).toBe('false')
    expect(screen.getByTestId('executing-diff-filter-del').getAttribute('data-active')).toBe('false')

    // 3 个文件卡片
    const files = screen.getAllByTestId('executing-diff-file')
    expect(files.length).toBe(3)

    // 第 1 个文件:18 / -7
    const first = files[0]
    expect(first.getAttribute('data-added')).toBe('18')
    expect(first.getAttribute('data-removed')).toBe('7')
    expect(first.getAttribute('data-file-path')).toContain('RefundController')

    // 第 3 个文件:deleted badge
    const third = files[2]
    expect(third.getAttribute('data-badge')).toBe('deleted')

    // 至少有 add 和 rem 行
    const addLines = screen.getAllByTestId('executing-diff-line')
    const addCount = addLines.filter(
      (l) => l.getAttribute('data-line-kind') === 'add',
    ).length
    const remCount = addLines.filter(
      (l) => l.getAttribute('data-line-kind') === 'rem',
    ).length
    expect(addCount).toBeGreaterThan(0)
    expect(remCount).toBeGreaterThan(0)

    // 累计 +18 / -7 在列头
    expect(screen.getByTestId('executing-diff-title').textContent).toContain(
      '+18',
    )
    expect(screen.getByTestId('executing-diff-title').textContent).toContain('-7')
  })

  it('AI 行为流列:事件卡片 + tone 变体 + 时间范围', async () => {
    const data = await getExecutingData('req-001')
    render(<ExecutingZone data={data} />)

    // 7 个事件
    const events = screen.getAllByTestId('executing-ai-event')
    expect(events.length).toBe(7)

    // tone 变体:warn / success / info
    const tones = events.map((e) => e.getAttribute('data-tone'))
    expect(tones).toContain('warn')
    expect(tones).toContain('success')
    expect(tones).toContain('info')

    // warn 事件有 border-l-warning
    const warnEvent = events.find((e) => e.getAttribute('data-tone') === 'warn')!
    expect(warnEvent.className).toContain('border-l-warning')

    // 时间范围显示(从最早到最近)
    expect(screen.getByTestId('executing-ai-time-range').textContent).toBe(
      '14:00–14:24',
    )

    // Edit 事件含 stats(+18 / -7)
    const statsNode = screen.getByTestId('executing-ai-event-stats')
    expect(statsNode.getAttribute('data-added')).toBe('18')
    expect(statsNode.getAttribute('data-removed')).toBe('7')

    // 至少 1 个事件含 acts 按钮
    const actButtons = screen.getAllByTestId('executing-ai-event-act')
    expect(actButtons.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// 空态
// ============================================================================

describe('ExecutingZone · 空数据', () => {
  it('empty=true 时渲染空态引导,不渲染三列', () => {
    const data = emptyExecuting('NEW-REQ')
    render(<ExecutingZone data={data} />)

    const root = screen.getByTestId('executing-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    // 引导文案
    expect(screen.getByText('EXECUTING 工位暂无任务')).toBeInTheDocument()

    // CTA 跳 DRAFTING 工位
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting/')

    // 三列都不渲染
    expect(screen.queryByTestId('executing-mc-main')).toBeNull()
    expect(screen.queryByTestId('executing-dag-col')).toBeNull()
    expect(screen.queryByTestId('executing-diff-col')).toBeNull()
    expect(screen.queryByTestId('executing-ai-col')).toBeNull()
  })

  it('空数据时顶层不崩(挂载即返回)', () => {
    expect(() =>
      render(<ExecutingZone data={emptyExecuting('X')} />),
    ).not.toThrow()
  })
})

// ============================================================================
// 错误态 — 数据缺字段 / 极端输入不应崩
// ============================================================================

describe('ExecutingZone · 错误态(边界)', () => {
  it('tasks 为空但 empty=false 时,三列仍渲染,无任务时不报 key 错', () => {
    const partial: ExecutingData = {
      ...emptyExecuting('PARTIAL'),
      empty: false,
      dag: {
        block: { title: '任务 DAG', meta: '0/0', tasks: [] },
        tasks: [],
      },
      diff: { files: [], cumulativeText: 'Diff 流' },
      aiEvents: [],
      stage: {
        badge: '⑤ 编码',
        title: 'IMPLEMENTING · Mission Control',
        metaLeft: '0/0',
        metaCenter: '0%',
        metaRight: '',
      },
      toolbar: {
        crumb: [{ label: '任务', current: true }],
        actions: [],
      },
    }
    render(<ExecutingZone data={partial} />)
    expect(screen.getByTestId('executing-zone').getAttribute('data-empty')).toBe('false')
    expect(screen.queryAllByTestId('executing-dag-task').length).toBe(0)
    // stats 全 0
    expect(screen.getByTestId('executing-dag-stat-done').getAttribute('data-n')).toBe('0')
  })

  it('Diff 文件 lines 为空时仍渲染文件卡片(只是空行)', () => {
    const data: ExecutingData = {
      ...emptyExecuting('EMPTY-DIFF'),
      empty: false,
      diff: {
        files: [
          { path: 'src/empty.ts', icon: '🌿', added: 0, removed: 0, lines: [] },
        ],
        cumulativeText: 'Diff 流',
      },
      stage: {
        badge: '⑤ 编码',
        title: 'IMPLEMENTING',
        metaLeft: '',
        metaCenter: '',
        metaRight: '',
      },
      toolbar: { crumb: [{ label: 'A', current: true }], actions: [] },
      dag: {
        block: { title: 'DAG', meta: '', tasks: [] },
        tasks: [],
      },
      aiEvents: [],
    }
    render(<ExecutingZone data={data} />)
    const files = screen.getAllByTestId('executing-diff-file')
    expect(files.length).toBe(1)
    expect(files[0].getAttribute('data-added')).toBe('0')
  })

  it('AI events 为空时,AI 列显示"暂无 AI 事件"占位', () => {
    const data: ExecutingData = {
      ...emptyExecuting('EMPTY-AI'),
      empty: false,
      aiEvents: [],
      stage: {
        badge: '⑤ 编码',
        title: 'IMPLEMENTING',
        metaLeft: '',
        metaCenter: '',
        metaRight: '',
      },
      toolbar: { crumb: [{ label: 'A', current: true }], actions: [] },
      dag: { block: { title: '', meta: '', tasks: [] }, tasks: [] },
      diff: { files: [], cumulativeText: '' },
    }
    render(<ExecutingZone data={data} />)
    expect(screen.getByText('暂无 AI 事件')).toBeInTheDocument()
    expect(screen.getByTestId('executing-ai-time-range').textContent).toBe('—')
  })
})