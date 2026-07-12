import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { DesigningZone } from '@/components/designing-zone'
import { emptyDesigning, getDesigningData, type DesigningData } from '@/lib/designing'

afterEach(() => {
  cleanup()
})

// ============================================================================
// 满数据渲染 — Compare 形态(主区全宽,对应原型 11c)
// ============================================================================

describe('DesigningZone · 满数据渲染', () => {
  it('根节点 + stage strip + toolbar + 候选卡片 三段全部存在', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const root = screen.getByTestId('designing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')

    // Stage strip:④ 设计 + DESIGNING · Compare
    expect(screen.getByTestId('designing-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('designing-stage-badge').textContent).toBe(
      '④ 设计',
    )
    expect(
      screen.getByTestId('designing-stage-title').textContent,
    ).toContain('DESIGNING')
    expect(
      screen.getByTestId('designing-stage-title').textContent,
    ).toContain('Compare')

    // Toolbar:面包屑 + 形态标签
    expect(screen.getByTestId('designing-toolbar')).toBeInTheDocument()
    const current = screen.getByTestId('designing-crumb-current')
    expect(current.textContent).toBe('方案评审')
    expect(current.getAttribute('data-current')).toBe('true')

    // 候选卡片 3 张
    const cards = screen.getAllByTestId('designing-candidate-card')
    expect(cards.length).toBe(3)
  })

  it('每张候选卡片渲染:标题 + tag + 优缺点 + 量化指标 + 采纳按钮', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const cards = screen.getAllByTestId('designing-candidate-card')
    for (const card of cards) {
      // 标题(tag 内:A/B/C 编号 + 标题)
      expect(within(card).getByTestId('designing-candidate-tag')).toBeInTheDocument()
      // 优缺点各至少 1 条
      expect(card.textContent).toMatch(/✓/)
      // 量化指标区域
      expect(within(card).getByTestId('designing-candidate-metrics')).toBeInTheDocument()
      // 采纳按钮
      const adopt = within(card).getByTestId('designing-candidate-adopt')
      expect(adopt).toBeInTheDocument()
      expect(adopt.textContent).toMatch(/✓/)
    }
  })

  it('AI 推荐卡片(B)有 data-recommended="true" + 视觉高亮', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const cards = screen.getAllByTestId('designing-candidate-card')
    const cardA = cards.find((c) => c.getAttribute('data-candidate-id') === 'A')
    const cardB = cards.find((c) => c.getAttribute('data-candidate-id') === 'B')
    const cardC = cards.find((c) => c.getAttribute('data-candidate-id') === 'C')
    expect(cardA).toBeDefined()
    expect(cardB).toBeDefined()
    expect(cardC).toBeDefined()
    expect(cardA!.getAttribute('data-recommended')).toBe('false')
    expect(cardB!.getAttribute('data-recommended')).toBe('true')
    expect(cardC!.getAttribute('data-recommended')).toBe('false')

    // 推荐 card 的 tag 显示 "AI 推荐"
    expect(within(cardB!).getByTestId('designing-candidate-tag').textContent).toContain(
      '推荐',
    )
  })

  it('设计文档渲染:左侧标题 + markdown 正文 + TOC 锚点列表', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const doc = screen.getByTestId('designing-design-doc')
    expect(within(doc).getByTestId('designing-design-doc-title').textContent).toContain(
      '设计文档',
    )
    // markdown 正文非空
    const body = within(doc).getByTestId('designing-design-doc-body')
    expect((body.textContent ?? '').length).toBeGreaterThan(20)

    // TOC 锚点 ≥ 3 条
    const tocItems = within(doc).getAllByTestId('designing-toc-item')
    expect(tocItems.length).toBeGreaterThanOrEqual(3)
  })

  it('底部取舍点区域:每候选一行总结 + AI 推荐提示', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const tradeoff = screen.getByTestId('designing-tradeoff')
    const rows = within(tradeoff).getAllByTestId('designing-tradeoff-row')
    expect(rows.length).toBe(3)
    // 每行以候选 id (A/B/C) 开头
    expect(within(tradeoff).getByText(/A ·/)).toBeInTheDocument()
    expect(within(tradeoff).getByText(/B ·/)).toBeInTheDocument()
    expect(within(tradeoff).getByText(/C ·/)).toBeInTheDocument()

    // AI 推荐提示(包含"推荐"和候选名)
    const reco = within(tradeoff).getByTestId('designing-recommendation')
    expect(reco.textContent).toContain('B')
  })

  it('每张候选卡片头有 yellow 状态点(决策 22 等待决策),未选时 data-status="awaiting"', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const statusRows = screen.getAllByTestId('designing-card-status')
    expect(statusRows.length).toBe(3)
    for (const row of statusRows) {
      expect(row.getAttribute('data-status')).toBe('awaiting')
      expect(row.textContent).toContain('等待决策')
    }
  })

  it('设计文档正文是 h2 标题 + 段落(非 <pre> 原文),h2 带 id 可被 TOC 锚点命中', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const body = screen.getByTestId('designing-design-doc-body')
    // 至少有 4 个 h2(问题背景 / 范围 / 关键流程 / 非目标)
    const headings = body.querySelectorAll('h2[data-doc-heading]')
    expect(headings.length).toBeGreaterThanOrEqual(4)
    // 每个 h2 都有非空 id
    for (const h of Array.from(headings)) {
      expect(h.id.length).toBeGreaterThan(0)
    }

    // 文档里有锚点匹配 TOC 的 href(比如 #问题背景 → h2 id="问题背景")
    const docToc = screen.getByTestId('designing-doc-toc')
    const tocAnchors = within(docToc).getAllByTestId('designing-toc-item')
    expect(tocAnchors.length).toBeGreaterThanOrEqual(3)
    for (const tocItem of tocAnchors) {
      const id = tocItem.getAttribute('data-toc-id')
      const matchingH = body.querySelector(`h2[id="${id}"]`)
      expect(matchingH, `TOC id=${id} 找不到匹配的 h2`).not.toBeNull()
    }
  })
})

// ============================================================================
// 交互:选 A/B/C + 让 AI 重做 + 自定义调整
// ============================================================================

describe('DesigningZone · Compare 交互', () => {
  it('点击候选卡片 [✓ 采纳 X] → 触发 onSelect,载荷 candidateId', async () => {
    const data = await getDesigningData('req-001')
    const onSelect = vi.fn()
    render(<DesigningZone data={data} onSelect={onSelect} />)

    const cards = screen.getAllByTestId('designing-candidate-card')
    const cardB = cards.find((c) => c.getAttribute('data-candidate-id') === 'B')!
    const adopt = within(cardB).getByTestId('designing-candidate-adopt')
    fireEvent.click(adopt)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toEqual({ candidateId: 'B' })
  })

  it('选中后:卡片出现 data-selected="true" + 切到 EXECUTING 引导卡出现', async () => {
    // 注:selected 是 useState 内部维护,渲染初始 selectedCandidateId=null,
    // 点击后 useState 置成 'B' → 视觉反馈 + 引导卡
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const cards0 = screen.getAllByTestId('designing-candidate-card')
    const cardB0 = cards0.find((c) => c.getAttribute('data-candidate-id') === 'B')!
    expect(cardB0.getAttribute('data-selected')).toBe('false')
    expect(screen.queryByTestId('designing-decision-bar')).toBeNull()

    const adopt = within(cardB0).getByTestId('designing-candidate-adopt')
    fireEvent.click(adopt)

    // 选完后重查(React 已重渲染)
    const cards1 = screen.getAllByTestId('designing-candidate-card')
    const cardB1 = cards1.find((c) => c.getAttribute('data-candidate-id') === 'B')!
    expect(cardB1.getAttribute('data-selected')).toBe('true')
    // 其它卡片 data-selected=false
    const cardA1 = cards1.find((c) => c.getAttribute('data-candidate-id') === 'A')!
    expect(cardA1.getAttribute('data-selected')).toBe('false')

    // yellow 状态点切到 success(决策 22:已选 → 绿色"已选 X")
    const statusB = within(cardB1).getByTestId('designing-card-status')
    expect(statusB.getAttribute('data-status')).toBe('chosen')
    expect(statusB.textContent).toContain('已选 B')

    // 引导卡出现
    expect(screen.getByTestId('designing-decision-bar')).toBeInTheDocument()
    expect(screen.getByTestId('designing-decision-bar').textContent).toContain('B')
  })

  it('选中引导卡 → [切到 EXECUTING] 是 Link,href 到 /executing/', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const cardB = screen
      .getAllByTestId('designing-candidate-card')
      .find((c) => c.getAttribute('data-candidate-id') === 'B')!
    fireEvent.click(within(cardB).getByTestId('designing-candidate-adopt'))

    const goLink = screen.getByTestId('designing-decision-go')
    expect(goLink.getAttribute('href')).toBe('/requirements/req-001/executing')

    // "留在此处"按钮可关闭
    const stayBtn = screen.getByTestId('designing-decision-stay')
    fireEvent.click(stayBtn)
    expect(screen.queryByTestId('designing-decision-bar')).toBeNull()
  })

  it('[↻ 让 AI 重新生成] 触发 onRegenerate(空 hint)', async () => {
    const data = await getDesigningData('req-001')
    const onRegenerate = vi.fn()
    render(<DesigningZone data={data} onRegenerate={onRegenerate} />)

    const regen = screen.getByTestId('designing-toolbar-regenerate')
    fireEvent.click(regen)

    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onRegenerate.mock.calls[0][0]).toEqual({})
  })

  it('✏️ 自定义调整输入框:输入 hint 后点提交 → onRegenerate({ hint })', async () => {
    const data = await getDesigningData('req-001')
    const onRegenerate = vi.fn()
    render(<DesigningZone data={data} onRegenerate={onRegenerate} />)

    const custom = screen.getByTestId('designing-custom-input')
    fireEvent.change(custom, { target: { value: '把方案 B 改造一下,降低运维成本' } })

    const submit = screen.getByTestId('designing-custom-submit')
    fireEvent.click(submit)

    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onRegenerate.mock.calls[0][0]).toEqual({
      hint: '把方案 B 改造一下,降低运维成本',
    })
  })

  it('✏️ 自定义调整:空文本时提交按钮 disabled', async () => {
    const data = await getDesigningData('req-001')
    render(<DesigningZone data={data} />)

    const submit = screen.getByTestId('designing-custom-submit')
    expect(submit.hasAttribute('disabled')).toBe(true)
  })

  it('✏️ 自定义调整:输入 + Enter 也提交(键盘可达)', async () => {
    const data = await getDesigningData('req-001')
    const onRegenerate = vi.fn()
    render(<DesigningZone data={data} onRegenerate={onRegenerate} />)

    const custom = screen.getByTestId('designing-custom-input')
    fireEvent.change(custom, { target: { value: '试试异步方案' } })
    fireEvent.keyDown(custom, { key: 'Enter' })

    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onRegenerate.mock.calls[0][0]).toEqual({ hint: '试试异步方案' })
  })
})

// ============================================================================
// 决策 22 交叉验证 — ZoneBar DESIGNING 黄点
// (主测试在 zone-bar.test.tsx;此处绑定到 issue 21 验收)
// ============================================================================

describe('DesigningZone · ZoneBar 决策 22 联动', () => {
  it('ZONE_STATUS_COLOR_CLASS[yellow] = "bg-yellow-500"', () => {
    return import('@/lib/zones').then(({ ZONE_STATUS_COLOR_CLASS }) => {
      expect(ZONE_STATUS_COLOR_CLASS.yellow).toBe('bg-yellow-500')
    })
  })

  it('DESIGNING 工位的 status_color 在元数据中标记为 yellow', () => {
    return import('@/lib/zones').then(({ ZONE_META }) => {
      const designing = ZONE_META.find((z) => z.id === 'designing')
      expect(designing).toBeDefined()
      expect(designing!.status_color).toBe('yellow')
    })
  })
})

// ============================================================================
// 空数据 — 引导去 ANALYZING(issue 19 同模式)
// ============================================================================

describe('DesigningZone · 空数据', () => {
  it('empty=true 渲染空态引导,卡片 / 取舍 / 引导卡 都不渲染', () => {
    const data = emptyDesigning('NEW-REQ')
    render(<DesigningZone data={data} />)

    const root = screen.getByTestId('designing-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    expect(screen.getByText('DESIGNING 工位暂无方案')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 ANALYZING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/analyzing')

    expect(screen.queryByTestId('designing-candidate-card')).toBeNull()
    expect(screen.queryByTestId('designing-tradeoff')).toBeNull()
    expect(screen.queryByTestId('designing-decision-bar')).toBeNull()
  })
})

// ============================================================================
// 边界 — 顶层不崩 / 候选数 < 3 也允许
// ============================================================================

describe('DesigningZone · 边界', () => {
  it('顶层不崩(空对象 mount 即返回)', () => {
    expect(() =>
      render(<DesigningZone data={emptyDesigning('X')} />),
    ).not.toThrow()
  })

  it('已选状态预设(直接 initial selectedCandidateId="B")也正确渲染决策卡', async () => {
    // 服务端 SSR 兜底用 selectedCandidateId 优先(避免 hydration 不一致)
    const base = await getDesigningData('req-001')
    const data: DesigningData = { ...base, selectedCandidateId: 'B' }
    render(<DesigningZone data={data} />)
    expect(screen.getByTestId('designing-decision-bar')).toBeInTheDocument()
    const cardB = screen
      .getAllByTestId('designing-candidate-card')
      .find((c) => c.getAttribute('data-candidate-id') === 'B')
    expect(cardB).toBeDefined()
    expect(cardB!.getAttribute('data-selected')).toBe('true')
  })

  it('默认 no-op 回调(不传 onSelect / onRegenerate)点击不会抛错', async () => {
    const data = await getDesigningData('req-001')
    expect(() => render(<DesigningZone data={data} />)).not.toThrow()
    const cardA = screen
      .getAllByTestId('designing-candidate-card')
      .find((c) => c.getAttribute('data-candidate-id') === 'A')!
    expect(() =>
      fireEvent.click(within(cardA).getByTestId('designing-candidate-adopt')),
    ).not.toThrow()
    fireEvent.click(screen.getByTestId('designing-toolbar-regenerate'))
  })
})
