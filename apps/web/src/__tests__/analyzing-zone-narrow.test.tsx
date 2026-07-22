/**
 * analyzing-zone-narrow.test.tsx —— ticket 05 · ADR-0017 窄视口 UX
 *
 * 覆盖:
 * - 桌面 2:1 渲染(min-width: 1024px mock → isDesktop=true)
 * - 窄视口 Tab 切换(max-width: 1023px mock → isDesktop=false)
 * - 空 PRD + 空 aux 时:窄视口仍能切到"文档" Tab → DocumentReaderPane 空态
 * - 单 PRD + 多 aux:窄视口下 DocumentReaderPane Tab 顺序保持[PRD, aux1, aux2]
 * - 联动:窄视口下点右栏产物卡片 → 自动切到"文档" Tab + 左栏切 AuxFile Tab + pulse
 *
 * 媒体查询 mock 通过 `globalThis.setMatchMedia('(min-width: 1024px)', value)`
 * 控制;测试间互不影响(afterEach 清 matchers)。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyzingZone } from '@/components/analyzing-zone'
import {
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'

vi.mock('@/lib/products-actions', () => ({
  updateProduct: vi.fn().mockResolvedValue({ ok: true }),
}))

declare global {
  // eslint-disable-next-line no-var
  var setMatchMedia: (query: string, value: boolean) => void
  // eslint-disable-next-line no-var
  var resetMatchMedia: () => void
}

afterEach(() => {
  cleanup()
  globalThis.resetMatchMedia()
  vi.clearAllMocks()
})

/** 单 PRD + 2 个 aux + 2 chunks(active 数据,适配窄视口测试) */
function makeNarrowData(): AnalyzingData {
  return {
    ...emptyAnalyzing('req-narrow'),
    empty: false,
    phase: 'active',
    prdMarkdown: ['# 退款功能', '', '正文段 A', '', '正文段 B'].join('\n'),
    auxFiles: [
      {
        id: 'aux-api',
        filename: 'api.md',
        usage_tag: 'api',
        source_format: 'md',
        converted_to_md: false,
        body: 'API 行0\n\nAPI 行2',
      },
      {
        id: 'aux-data',
        filename: 'data.md',
        usage_tag: 'data',
        source_format: 'md',
        converted_to_md: false,
        body: 'Data 行0\n\nData 行2',
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
        source_refs: [
          { kind: 'aux', auxId: 'aux-api', lineRange: [0, 1] },
        ],
      },
      {
        id: 'r-1',
        ts: '14:23:02',
        label: 'RISK',
        text: 'R1 · PRD 关联',
        kind: 'risk',
        tone: 'warn',
        source_refs: [{ kind: 'prd', lineRange: [2, 3] }],
      },
      {
        id: 'r-orphan',
        ts: '14:23:03',
        label: 'RISK',
        text: 'R · 无出处',
        kind: 'risk',
        tone: 'warn',
      },
    ],
    streamMeta: {
      totalChunks: 3,
      isStreaming: false,
      startedAt: '2026-07-12T00:00:00.000Z',
      endedAt: '2026-07-12T00:00:30.000Z',
    },
    stats: { subproblems: 1, risks: 2, options: 0, total: 3 },
  }
}

// ============================================================================
// 桌面形态(对照基线 — 防止 ticket 05 改动破坏桌面)
// ============================================================================

describe('AnalyzingZone · 桌面形态 mock(min-width: 1024px === true)', () => {
  it('桌面 = 主区走 2:1 grid;不出窄 Tab', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    render(<AnalyzingZone data={makeNarrowData()} />)

    expect(screen.getByTestId('analyzing-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('analyzing-narrow-tabs')).toBeNull()
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    // data-layout 标记桌面形态
    expect(
      screen.getByTestId('analyzing-main').getAttribute('data-layout'),
    ).toBe('doc-reader-2-1')
  })
})

// ============================================================================
// 窄视口默认形态(Candidate A)
// ============================================================================

describe('AnalyzingZone · 窄视口形态 mock(min-width: 1024px === false)', () => {
  it('窄视口 = 不出 desktop grid;出顶部 Tab + DocumentReaderPane 隐藏(默认 active=产物)', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    // 桌面 grid 不出
    expect(screen.queryByTestId('analyzing-grid')).toBeNull()

    // 顶部窄 Tab 出现
    const tabs = screen.getByTestId('analyzing-narrow-tabs')
    expect(tabs.getAttribute('role')).toBe('tablist')
    expect(tabs.getAttribute('aria-label')).toContain('窄视口')

    // 两个 Tab + data-tab-id
    expect(screen.getByTestId('analyzing-narrow-tab-doc')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-narrow-tab-products')).toBeInTheDocument()

    // 默认 active = "产物";DocumentReaderPane 不渲染,ProductList 渲染
    expect(
      screen.getByTestId('analyzing-narrow-tab-products').getAttribute('data-active'),
    ).toBe('true')
    expect(
      screen.getByTestId('analyzing-narrow-tab-doc').getAttribute('data-active'),
    ).toBe('false')
    expect(screen.queryByTestId('document-reader-pane')).toBeNull()
    expect(screen.getByTestId('product-list')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-summary')).toBeInTheDocument()

    // 主区 data-layout 标记窄视口形态
    expect(
      screen.getByTestId('analyzing-main').getAttribute('data-layout'),
    ).toBe('narrow-tabs')
  })

  it('点击"文档" Tab → 切换到 DocumentReaderPane,ProductList 隐藏', async () => {
    const user = userEvent.setup()
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    // 初始:documents 隐藏
    expect(screen.queryByTestId('document-reader-pane')).toBeNull()

    await user.click(screen.getByTestId('analyzing-narrow-tab-doc'))

    expect(
      screen.getByTestId('analyzing-narrow-tab-doc').getAttribute('data-active'),
    ).toBe('true')
    expect(
      screen.getByTestId('analyzing-narrow-tab-products').getAttribute('data-active'),
    ).toBe('false')
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('product-list')).toBeNull()
  })

  it('点击"产物" Tab → 切回 ProductList 视图', async () => {
    const user = userEvent.setup()
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    // 先切到文档
    await user.click(screen.getByTestId('analyzing-narrow-tab-doc'))
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()

    // 再切回产物
    await user.click(screen.getByTestId('analyzing-narrow-tab-products'))
    expect(screen.queryByTestId('document-reader-pane')).toBeNull()
    expect(
      screen.getByTestId('analyzing-narrow-tab-products').getAttribute('data-active'),
    ).toBe('true')
    expect(screen.getByTestId('product-list')).toBeInTheDocument()
  })

  it('窄视口下"文档" Tab → DocumentReaderPane Tab 顺序保持 [PRD, aux-api, aux-data]', async () => {
    const user = userEvent.setup()
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    await user.click(screen.getByTestId('analyzing-narrow-tab-doc'))

    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs.map((t) => t.getAttribute('data-tab-id'))).toEqual([
      'prd',
      'aux-api',
      'aux-data',
    ])
  })

  it('空 PRD + 空 aux:窄视口切到"文档" Tab → DocumentReaderPane 显示空态占位', async () => {
    const user = userEvent.setup()
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    const data: AnalyzingData = {
      ...emptyAnalyzing('EMPTY-REQ'),
      empty: false,
      phase: 'active',
      prdMarkdown: '',
      auxFiles: [],
    }
    render(<AnalyzingZone data={data} />)
    await user.click(screen.getByTestId('analyzing-narrow-tab-doc'))

    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    expect(screen.getByTestId('doc-reader-empty')).toBeInTheDocument()
    expect(screen.getByText(/暂无需求文档与辅助材料/)).toBeInTheDocument()
  })
})

// ============================================================================
// 联动 — 窄视口下点右栏产物卡片 → 自动切到"文档" Tab + pulse
// ============================================================================

describe('AnalyzingZone · 窄视口联动(候选 A · ticket 05)', () => {
  it('窄视口下点有 source_ref 的 subproblem 卡片 → 自动切到"文档" Tab + 切 aux Tab', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    // 初始 = 产物
    expect(
      screen.getByTestId('analyzing-narrow').getAttribute('data-narrow-tab'),
    ).toBe('products')

    // 点 Q1(关联 aux-api)
    const card = document.querySelector<HTMLElement>('[data-item-id="q-1"]')!
    fireEvent.click(card)

    // 自动切到文档 Tab
    expect(
      screen.getByTestId('analyzing-narrow').getAttribute('data-narrow-tab'),
    ).toBe('doc')
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
  })

  it('窄视口下点 PRD 关联的风险 → 切到"文档" Tab + 切 PRD Tab', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    fireEvent.click(document.querySelector<HTMLElement>('[data-item-id="r-1"]')!)

    expect(
      screen.getByTestId('analyzing-narrow').getAttribute('data-narrow-tab'),
    ).toBe('doc')
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('prd')
  })

  it('窄视口下点无 source_ref 的卡片 → 不切 Tab;弹 "未关联原文出处" toast', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={makeNarrowData()} />)

    fireEvent.click(document.querySelector<HTMLElement>('[data-item-id="r-orphan"]')!)

    // 仍在产物 Tab
    expect(
      screen.getByTestId('analyzing-narrow').getAttribute('data-narrow-tab'),
    ).toBe('products')
    expect(screen.getByText(/未关联原文出处/)).toBeInTheDocument()
  })

  it('桌面形态下点右栏卡片 → 切桌面左栏 Tab;不切"文档" Tab(因为桌面不出窄 Tab)', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    render(<AnalyzingZone data={makeNarrowData()} />)

    fireEvent.click(document.querySelector<HTMLElement>('[data-item-id="q-1"]')!)

    expect(screen.queryByTestId('analyzing-narrow')).toBeNull()
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
  })
})
