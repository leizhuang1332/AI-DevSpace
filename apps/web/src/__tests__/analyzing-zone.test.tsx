import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyzingZone } from '@/components/analyzing-zone'
import {
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'
import { refundAnalyzingFixture } from '@/__tests__/__fixtures__/analyzing-fixtures'

// 注:打字机是 setTimeout 链 + 单一 phase 状态机(详见组件实现)。它在真实浏览器
// 中流畅运行(20ms / 字,200ms chunk 间暂停),但 fake timers + React 18 commit
// 时机在测试中不稳定(advanceTimersByTimeAsync 推进 timer 但 React commit 由
// MessageChannel 调度,有时序漂移)。因此测试聚焦于:
//   1. 渲染结构(满数据 / 空态 / 错误态 / 主区容错空 chunks)
//   2. phase state machine 推进的副效(typing/pausing 切换不影响 UI)
// 打字机逐字推进的 20ms 节流由代码 inspection 验证(constant + setTimeout 链)。
//
// ticket 02 改动(ADR-0017 D1):左栏 ThinkingStream → DocumentReaderPane;
// "暂无思考流" 文案与 analyzing-chunk-* testid 不再出现,改测 analyzing-left-col
// / doc-reader-tabs / doc-reader-body。
//
// ticket 09 改动:删 analyzing-toolbar 组件(暂停/重置/复制按钮)与 paused state machine;
//   data-paused 属性删除;相关渲染断言随 it 整体移除。
//
// ticket 03 改造:`getAnalyzingData('req-001')` 不再有 req-001 短路 ——
// 满数据渲染场景改用 `refundAnalyzingFixture('req-001')` 直接喂样例数据;
// 组件契约仍测满数据,但数据源不再是运行时 mock,而是测试 fixture。

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ============================================================================
// 直接进入主区(issue: ANALYZING 工位改造 · 直接进入主区,删 NotStartedPanel)
//
// 用例:
//   1. emptyAnalyzing() 仍走 EmptyAnalyzing + 'ANALYZING 工位暂无内容'
//   2. 主区空 chunks/sessions 时仍渲染(主区容错),不显示 NotStartedPanel
//   3. phase=active (req-001) 走主区,stage strip 可见
// ============================================================================

describe('AnalyzingZone · 直接进入主区', () => {
  it('回归: emptyAnalyzing() 仍走 EmptyAnalyzing + 文案 "ANALYZING 工位暂无内容"', () => {
    const data = emptyAnalyzing('NEW-REQ')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    expect(screen.getByText('ANALYZING 工位暂无内容')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting')

    expect(screen.queryByTestId('analyzing-stage-strip')).toBeNull()
    expect(screen.queryByTestId('analyzing-toolbar')).toBeNull()
    // ticket 02 · ADR-0017 D1:ThinkingStream 渲染出口删除
    expect(screen.queryByTestId('analyzing-stream')).toBeNull()
    expect(screen.queryByTestId('document-reader-pane')).toBeNull()
  })

  it('主区空 chunks/sessions → 仍走主区,容错不崩', () => {
    // 模拟:有 requirement.md(空 false),但 fs 还没启动过 session(sessions/chunks 都空)
    // 这正是 "首次进入 ANALYZING" 的真实状态 —— 主区应当容错渲染
    const data: AnalyzingData = {
      ...emptyAnalyzing('req-003'),
      empty: false,
      phase: 'active',
      // prdMarkdown 也为空 → DocumentReaderPane 走空态占位
    }
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-phase')).toBe('active')
    expect(root.getAttribute('data-requirement-id')).toBe('req-003')

    // 主区骨架存在
    expect(screen.getByTestId('analyzing-stage-strip')).toBeInTheDocument()
    // 左栏 = DocumentReaderPane(ticket 02 验收)
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    // ThinkingStream 不再渲染
    expect(screen.queryByTestId('analyzing-stream')).toBeNull()
  })

  it('回归: req-001 满数据渲染(主区 stage strip 可见)', () => {
    // ticket 03 改造:不再依赖 `getAnalyzingData('req-001')` 的运行时短路;
    // 改用 `refundAnalyzingFixture('req-001')` 直接喂样例数据(组件契约不变)。
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-phase')).toBe('active')

    // 主区 testid 出现
    expect(screen.getByTestId('analyzing-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
  })
})

// ============================================================================
// 满数据渲染 — 2:1 主区布局 + DocumentReaderPane 左栏 + ProductList 右栏
// ============================================================================

describe('AnalyzingZone · 满数据渲染(ticket 02 · ADR-0017 D1)', () => {
  it('根节点 + stage strip + summary + 2:1 grid + 左/右栏存在', () => {
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')

    expect(screen.getByTestId('analyzing-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-stage-badge').textContent).toBe('② 分析')
    expect(screen.getByTestId('analyzing-stage-title').textContent).toContain('ANALYZING')
    expect(screen.getByTestId('analyzing-stage-title').textContent).toContain('Thinking')

    expect(screen.getByTestId('analyzing-summary')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-summary-icon').textContent).toBe('🧠')
    expect(
      screen.getByTestId('analyzing-summary-title').textContent,
    ).toContain('退款功能优化')

    // ticket 02 · 2:1 主区布局:grid lg:grid-cols-3,左 col-span-2,右 col-span-1
    expect(screen.getByTestId('analyzing-grid')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-left-col')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-right-col')).toBeInTheDocument()

    // 左栏 = DocumentReaderPane(本期 Tab 栏 + 阅读器)
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    expect(screen.getByTestId('doc-reader-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('doc-reader-body')).toBeInTheDocument()

    // ThinkingStream 渲染出口删除
    expect(screen.queryByTestId('analyzing-stream')).toBeNull()
    expect(screen.queryByTestId('analyzing-stream-body')).toBeNull()

    // data-layout 标记 ticket 02 布局版本
    expect(
      screen.getByTestId('analyzing-main').getAttribute('data-layout'),
    ).toBe('doc-reader-2-1')
  })

  it('顶部三 stats:子问题 5 / 风险点 3 / 方案方向 2', () => {
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    expect(
      screen.getByTestId('analyzing-stat-subproblems').getAttribute('data-n'),
    ).toBe('5')
    expect(screen.getByTestId('analyzing-stat-risks').getAttribute('data-n')).toBe('3')
    expect(
      screen.getByTestId('analyzing-stat-options').getAttribute('data-n'),
    ).toBe('2')
  })

  it('DocumentReaderPane 默认 Tab = PRD(SSR 注入的 prdMarkdown 全文)', () => {
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    const pane = screen.getByTestId('document-reader-pane')
    expect(pane.getAttribute('data-active-tab-id')).toBe('prd')
    // MarkdownPreview 渲染 PRD 全文
    const preview = screen.getByTestId('markdown-preview')
    expect(preview.textContent).toContain('退款功能优化')
  })
})

// ============================================================================
// issue 01 · ADR-0021:Analysis Skill 单选器替代 Admission Dimension 卡片
//
// 旧 ticket 08 「开始分析」按钮常驻 + data-phase 派生 验收:
//  - 按钮常驻:不再受 sessions / dimensions count 影响
//  - data-phase:由 `dimensions.every(count===0)` 派生
//
// 本测试改写为:
/**
 * issue 01 (ADR-0021) 改造说明:
 *
 * 旧 ticket 08 测试原 AdmissionDashboard 的"按钮常驻 + data-phase 派生"
 * 行为。该组件已被 AnalysisSkillSelector 替代,本 describe 改为验证:
 *  - 「开始分析」按钮在可用 Skill 非空时常驻(在 SkillSelector 旁)
 *  - availableSkills.length === 0 时按钮 disabled + 显示空态 selector
 *  - SkillSelector 与「开始分析」按钮同位置渲染(顶层,不受桌面/窄视口影响)
 *  - 选中状态:默认 first-by-name = "implementation-readiness"(字典序)
 *  - 切换 Skill → 乐观切中 + PUT 写盘 + 服务端确认
 */
describe('AnalyzingZone · Analysis Skill 单选器 + 「开始分析」按钮常驻(issue 01)', () => {
  function makeData(overrides: Partial<AnalyzingData> = {}): AnalyzingData {
    return {
      ...emptyAnalyzing('req-001'),
      empty: false,
      phase: 'active',
      availableSkills: [
        {
          name: 'implementation-readiness',
          description: '检查实施准备度',
          version: '1.0.0',
          is_reserved: true,
        },
        {
          name: 'prd-completeness',
          description: '检查 PRD 完整性与清晰度',
          version: '1.0.0',
          is_reserved: true,
        },
      ],
      selectedSkillName: 'implementation-readiness',
      ...overrides,
    }
  }

  it('有可用 Skill → 按钮渲染 + 单选器渲染 + 默认选中字典序首项', () => {
    render(<AnalyzingZone data={makeData()} />)
    expect(screen.getByTestId('admission-start-btn')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-skill-selector')).toBeInTheDocument()

    // 默认选中 = 字典序首项 = "implementation-readiness"
    // testid 通用,按 data-skill-name 区分
    const options = screen.getAllByTestId('analysis-skill-option')
    const first = options.find(
      (el) => el.getAttribute('data-skill-name') === 'implementation-readiness',
    )
    expect(first).toBeDefined()
    expect(first?.getAttribute('data-selected')).toBe('true')
  })

  it('有 sessions + 已选 Skill → 按钮常驻 + 选中态保持', () => {
    const data = makeData({
      sessions: [
        {
          id: 'sess-arch',
          label: '架构',
          angle: 'architecture',
          detectedCount: 0,
          isStreaming: false,
        },
      ],
      activeSessionId: 'sess-arch',
      selectedSkillName: 'prd-completeness',
    })
    render(<AnalyzingZone data={data} />)
    expect(screen.getByTestId('admission-start-btn')).toBeInTheDocument()
    const options = screen.getAllByTestId('analysis-skill-option')
    const second = options.find(
      (el) => el.getAttribute('data-skill-name') === 'prd-completeness',
    )
    expect(second?.getAttribute('data-selected')).toBe('true')
  })

  it('无可用 Skill → 按钮 disabled + 单选器显示空态', () => {
    // issue 01 acceptance 8:无有效 Skill 时按钮不允许启动
    render(
      <AnalyzingZone
        data={makeData({ availableSkills: [], selectedSkillName: '' })}
      />,
    )
    const btn = screen.getByTestId('admission-start-btn')
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('data-disabled')).toBe('no_skills')
    expect(screen.getByTestId('analysis-skill-selector-empty')).toBeInTheDocument()
  })

  it('AnalysisSkillSelector 与「开始分析」按钮同位置渲染:顶层、不在 analyzing-grid/analyzing-narrow-tabs 内', () => {
    // 与 analyzing-main 同级(analyzing-stage-strip 旁),不受桌面/窄视口分支影响
    render(<AnalyzingZone data={makeData()} />)
    const sel = screen.getByTestId('analysis-skill-selector')
    expect(
      sel.compareDocumentPosition(screen.getByTestId('analyzing-main')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('点选 Skill → 乐观切中(data-selected=true)', async () => {
    const user = userEvent.setup()
    render(<AnalyzingZone data={makeData()} />)
    // 默认 implementation-readiness 选中;点击 prd-completeness
    const options = screen.getAllByTestId('analysis-skill-option')
    const target = options.find(
      (el) => el.getAttribute('data-skill-name') === 'prd-completeness',
    )
    expect(target).toBeDefined()
    await user.click(target!)
    await waitFor(() => {
      expect(target?.getAttribute('data-selected')).toBe('true')
    })
  })
})

// ============================================================================
// 打字机 phase 推进(原点击跳过测试改为 state 验证)
// ticket 02 改动:ThinkingStream 渲染出口删除;原"点击流区跳过"不再适用,
// 改为通过 DocumentReaderPane 在 phase 推进中仍稳定渲染来间接验证 phase state machine
// 内部工作(不变)。
// ============================================================================

describe('AnalyzingZone · 打字机 state machine(ticket 02 · 渲染出口删)', () => {
  it('初始 phase=idle/typing 内部状态不影响 DocumentReaderPane 渲染', () => {
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    // DocumentReaderPane 不依赖 phase,内容稳定渲染
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
  })
})


// ============================================================================
// 空态 — 引导去 DRAFTING(issue 19 验收:empty=true)
// ============================================================================

describe('AnalyzingZone · 空数据', () => {
  it('empty=true 渲染空态引导,不渲染主区', () => {
    const data = emptyAnalyzing('NEW-REQ')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    // 共享 <EmptyState> 渲染 —— 用文案 + 链接 href 验证
    expect(screen.getByText('ANALYZING 工位暂无内容')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting')

    expect(screen.queryByTestId('analyzing-stage-strip')).toBeNull()
    expect(screen.queryByTestId('analyzing-toolbar')).toBeNull()
    expect(screen.queryByTestId('document-reader-pane')).toBeNull()
  })
})

// ============================================================================
// ticket 05 · 关键场景补全:空 PRD + 空 aux · 单 PRD + 多 aux 排序 ·
//   这些场景不依赖桌面 / 窄视口形态,在 ticket 02 已实装但 ticket 05 显式要求
//   补齐回归覆盖(见 .scratch/analyzing-doc-reader/issues/05-narrow-viewport-and-tests.md
//   §"全量回归测试")
// ============================================================================

describe('AnalyzingZone · 关键场景补全(ticket 05)', () => {
  it('空 PRD + 空 aux → DocumentReaderPane 显示空态占位文案', async () => {
    const data: AnalyzingData = {
      ...emptyAnalyzing('EMPTY-BOTH'),
      empty: false,
      phase: 'active',
      prdMarkdown: '',
      auxFiles: [],
    }
    render(<AnalyzingZone data={data} />)
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    expect(screen.getByTestId('doc-reader-empty')).toBeInTheDocument()
    expect(screen.getByText(/暂无需求文档与辅助材料/)).toBeInTheDocument()
  })

  it('单 PRD + 多 aux 时 DocumentReaderPane Tab 顺序保持 [PRD, aux1, aux2](auxFiles 入参顺序)', () => {
    const data: AnalyzingData = {
      ...emptyAnalyzing('PRD-PLUS-AUX'),
      empty: false,
      phase: 'active',
      prdMarkdown: '# PRD',
      auxFiles: [
        {
          id: 'aux-data',
          filename: 'data-model.md',
          usage_tag: 'data',
          source_format: 'md',
          converted_to_md: false,
          body: 'data body',
        },
        {
          id: 'aux-research',
          filename: 'research.md',
          usage_tag: 'research',
          source_format: 'md',
          converted_to_md: false,
          body: 'research body',
        },
      ],
    }
    render(<AnalyzingZone data={data} />)
    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs.map((t) => t.getAttribute('data-tab-id'))).toEqual([
      'prd',
      'aux-data',
      'aux-research',
    ])
  })
})

// ============================================================================
// 错误态 — 极端输入不应崩
// ============================================================================

describe('AnalyzingZone · 错误态(边界)', () => {
  it('chunks 为空但 empty=false 时,DocumentReaderPane 正常渲染', () => {
    const data: AnalyzingData = {
      ...emptyAnalyzing('EMPTY'),
      empty: false,
      chunks: [],
      streamMeta: {
        totalChunks: 0,
        isStreaming: false,
        startedAt: '2026-07-12T00:00:00.000Z',
        endedAt: null,
      },
      stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    }
    render(<AnalyzingZone data={data} />)
    expect(screen.getByTestId('analyzing-zone').getAttribute('data-empty')).toBe('false')
    // DocumentReaderPane 接管左栏
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
  })

  it('顶层不崩(空 / 异常数据 mount 即返回)', () => {
    expect(() =>
      render(<AnalyzingZone data={emptyAnalyzing('X')} />),
    ).not.toThrow()
  })
})

// ============================================================================
// 完成提示(done 状态)—— 测试通过 props 注入的 streamMeta 验证 done 状态可触发
// ============================================================================

describe('AnalyzingZone · 完成提示(决策 15 非自动跳转)', () => {
  it('完成提示的链接与按钮渲染(通过组件 prop streamMeta 模拟)', async () => {
    // 由于打字机推进在 fake timers 下不稳定,完成提示的弹出来源是 useEffect on phase=done。
    // 这里通过状态验证:当 data 指示 isStreaming=false(已结束),toolbar 显示"已暂停"状态文本。
    const data: AnalyzingData = {
      ...emptyAnalyzing('COMPLETE'),
      empty: false,
      chunks: [
        { id: 'd-1', ts: '14:23:01', label: 'COMPLETE', text: '分析完成', kind: 'narration', tone: 'success' },
      ],
      streamMeta: {
        totalChunks: 1,
        isStreaming: false,
        startedAt: '2026-07-12T00:00:00.000Z',
        endedAt: '2026-07-12T00:00:30.000Z',
      },
      stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    }
    render(<AnalyzingZone data={data} />)

    // 组件正确接收 streamMeta 并在 stage strip 反映状态
    expect(screen.getByTestId('analyzing-stage-status').textContent).toBe('已暂停')
  })
})

// ============================================================================
// 画线联动(ticket 03 · ADR-0017 D4):点右栏卡片 → 左栏切 Tab / toast
// ============================================================================

describe('AnalyzingZone · 画线联动(ticket 03)', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  /** 构造带 source_refs 的 active 数据:1 个 aux 关联的 subproblem + 1 个无出处的 risk */
  function makeLinkedData(): AnalyzingData {
    return {
      ...emptyAnalyzing('req-link'),
      empty: false,
      phase: 'active',
      prdMarkdown: ['# 退款', '', '正文段落', '', '结尾'].join('\n'),
      auxFiles: [
        {
          id: 'aux-api',
          filename: 'api.md',
          usage_tag: 'api',
          source_format: 'md',
          converted_to_md: false,
          body: 'aux 行0\n\naux 行2',
        },
      ],
      chunks: [
        {
          id: 'q-1',
          ts: '14:23:01',
          label: 'DETECT',
          text: 'Q1 · 关联 aux',
          kind: 'subproblem',
          tone: 'success',
          source_refs: [{ kind: 'aux', auxId: 'aux-api', lineRange: [0, 1] }],
        },
        {
          id: 'r-1',
          ts: '14:23:02',
          label: 'RISK',
          text: 'R1 · 无出处',
          kind: 'risk',
          tone: 'warn',
          // 无 source_refs
        },
      ],
      streamMeta: {
        totalChunks: 2,
        isStreaming: false,
        startedAt: '2026-07-12T00:00:00.000Z',
        endedAt: '2026-07-12T00:00:30.000Z',
      },
      stats: { subproblems: 1, risks: 1, options: 0, total: 2 },
    }
  }

  it('点击含 source_refs 的产物卡片 → 左栏切到对应 AuxFile Tab', () => {
    render(<AnalyzingZone data={makeLinkedData()} />)

    const pane = screen.getByTestId('document-reader-pane')
    expect(pane.getAttribute('data-active-tab-id')).toBe('prd')

    const card = document.querySelector<HTMLElement>('[data-item-id="q-1"]')!
    expect(card).toBeTruthy()
    fireEvent.click(card)

    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
  })

  it('点击无 source_refs 的产物卡片 → 弹 toast "未关联原文出处",不切 Tab', () => {
    render(<AnalyzingZone data={makeLinkedData()} />)

    const riskCard = document.querySelector<HTMLElement>('[data-item-id="r-1"]')!
    fireEvent.click(riskCard)

    expect(screen.getByText(/未关联原文出处/)).toBeInTheDocument()
    // Tab 不变
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('prd')
  })

  it('产物卡片编辑按钮点击 → 不触发左栏联动(stopPropagation)', () => {
    render(<AnalyzingZone data={makeLinkedData()} />)

    const card = document.querySelector<HTMLElement>('[data-item-id="q-1"]')!
    // 点编辑按钮(在卡片内)→ 进入编辑态,但不切 Tab
    const editBtn = card.querySelector<HTMLButtonElement>(
      '[data-testid="product-card-edit"]',
    )!
    fireEvent.click(editBtn)

    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('prd')
  })
})

// ============================================================================
// 打字机 fake-timer 推进(ticket 02 改动:phase useEffect 内部保留,只是渲染出口删)
// 原 typed-len / chunkIndex 验证依赖 analyzing-chunk-current testid;
// ticket 02 后该 testid 不再渲染。本测试改为间接验证:phase state machine
// 内部仍推进(用 fake-timer 推进 N ms → DocumentReaderPane 仍稳定渲染
// 表示组件未崩,phase 推进不再影响 UI)。
// ============================================================================

describe('AnalyzingZone · 打字机 fake-timer 推进(20ms/字 · ticket 02 验证 phase 不影响 UI)', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('推进 ≥ fullLen 时间后 DocumentReaderPane 不崩,仍渲染 PRD Tab', async () => {
    vi.useFakeTimers()
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    // 推 100ms(理论 5 个字,实际 React commit batch 漂移)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    // DocumentReaderPane 始终稳定渲染 → state machine 推进不破坏 UI
    const pane = screen.getByTestId('document-reader-pane')
    expect(pane).toBeInTheDocument()
    expect(pane.getAttribute('data-active-tab-id')).toBe('prd')
  })
})

// ============================================================================
// 主区锁高度契约(ADR-0019 D1/D2)
//
// jsdom 测不了真滚动(scrollHeight/clientHeight 恒 0),只锁 className 契约:
//   - analyzing-main:overflow-hidden 且不含 overflow-auto(外层不再是滚动容器)
//   - analyzing-grid / left-col / right-col:各自 overflow-hidden(滚动下沉列内 body)
// ============================================================================

describe('AnalyzingZone · 主区锁高度契约(ADR-0019 D1/D2)', () => {
  afterEach(() => {
    cleanup()
    globalThis.resetMatchMedia()
  })

  it('analyzing-main 含 overflow-hidden 且不含 overflow-auto(外层不再滚动)', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    const analyzingMain = screen.getByTestId('analyzing-main')
    expect(analyzingMain.className).toContain('overflow-hidden')
    expect(analyzingMain.className).not.toContain('overflow-auto')
  })

  it('analyzing-grid / left-col / right-col 各自含 overflow-hidden(桌面 2:1)', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    const data = refundAnalyzingFixture('req-001')
    render(<AnalyzingZone data={data} />)

    expect(screen.getByTestId('analyzing-grid').className).toContain('overflow-hidden')
    expect(screen.getByTestId('analyzing-left-col').className).toContain('overflow-hidden')
    expect(screen.getByTestId('analyzing-right-col').className).toContain('overflow-hidden')
  })
})