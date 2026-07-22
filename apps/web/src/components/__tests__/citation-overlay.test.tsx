import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { useRef, type RefObject } from 'react'
import type { AnalyzingChunk } from '@/lib/analyzing'
import { CitationOverlay } from '../citation-overlay'

// ============================================================================
// jsdom 几何 mock
// ============================================================================
//
// jsdom 默认 `getBoundingClientRect()` 全元素返回 {0,0,0,0,0,0,0,0},会触发
// CitationOverlay 的"0×0 视口 → 跳过重算"短路逻辑,无法验证 SVG path 渲染。
// 这里把整 DOM 树统一给一份合理的 100×100 矩形;源点和终点各占一半,
// 让 line 至少能在两端各画一段。坐标精度不重要 —— 本测试只验证 path 数量
// 与产品/卡片 DOM 存在性,几何正确性留 E2E。
//
// scrollIntoView 也不实现 → 桩掉(对齐 analyzing-zone.test 的做法)。
// ============================================================================

beforeEach(() => {
  const fakeRect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  }
  // jsdom 中 SVGElement 继承自 Element,与 HTMLElement 并列;两边都要 patch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window.HTMLElement.prototype as any).getBoundingClientRect = function () {
    return fakeRect
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window.SVGElement.prototype as any).getBoundingClientRect = function () {
    return fakeRect
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window.HTMLElement.prototype as any).scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ============================================================================
// TestHarness:模拟 ProductList + DocumentReaderPane 的 DOM 结构,透传 ref 给 CitationOverlay
// ============================================================================

interface TestHarnessProps {
  chunks: AnalyzingChunk[]
  isDesktop?: boolean
  /** 注入到 mock DocumentReaderPane 的 data-active-tab-id;默认 'prd' */
  activeTabId?: string
  /** 注入到 mock DocumentReaderPane 的 activeTabIds(切 Tab 时被点击) */
  onActiveTabIdChange?: (id: string) => void
}

function TestHarness({
  chunks,
  isDesktop = true,
  activeTabId = 'prd',
}: TestHarnessProps) {
  const productListRef = useRef<HTMLDivElement>(null)
  const docPaneRef = useRef<HTMLDivElement>(null)
  return (
    <div>
      {/* 模拟 ProductList 容器 */}
      <div data-testid="product-list" ref={productListRef}>
        {/* 用 chunk.id 作为 data-product-id;CitationOverlay 查这个属性 */}
        {chunks
          .filter((c) => c.kind !== 'narration')
          .map((c) => (
            <div
              key={c.id}
              data-testid={`mock-product-${c.id}`}
              data-product-id={c.id}
            >
              {c.text}
            </div>
          ))}
      </div>
      {/* 模拟 DocumentReaderPane 容器 + body + mark spans */}
      <div
        data-testid="document-reader-pane"
        ref={docPaneRef}
        data-active-tab-id={activeTabId}
      >
        <div data-testid="doc-reader-body">
          {chunks
            .filter((c) => c.kind !== 'narration')
            .flatMap((c) => c.source_refs ?? [])
            .filter((r) => r.kind !== 'asset')
            .map((r, i) => (
              <mark
                key={`${r.kind}-${r.kind === 'aux' ? r.auxId : ''}-${r.lineRange[0]}-${r.lineRange[1]}-${i}`}
                data-testid="citation-highlight"
                data-line-start={r.lineRange[0]}
                data-line-end={r.lineRange[1]}
                data-line-tab-id={activeTabId}
              >
                mark-{r.lineRange[0]}
              </mark>
            ))}
        </div>
      </div>
      <CitationOverlay
        chunks={chunks}
        productListRef={productListRef as RefObject<HTMLElement | null>}
        documentBodyRef={docPaneRef as RefObject<HTMLElement | null>}
        isDesktop={isDesktop}
      />
    </div>
  )
}

// ============================================================================
// 渲染骨架
// ============================================================================

describe('CitationOverlay · 渲染骨架', () => {
  it('mounted 后 → 渲染 svg 元素 + 0 个 path(空 chunks)', async () => {
    const chunks: AnalyzingChunk[] = []
    const { container } = render(<TestHarness chunks={chunks} />)
    // 等 mounted → useEffect → recompute
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const svg = container.querySelector('[data-testid="citation-overlay"]')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('data-line-count')).toBe('0')
    expect(svg!.querySelectorAll('[data-testid="citation-overlay-line"]')).toHaveLength(0)
  })

  it('SVG 元素的关键属性(absolute / z-10 / pointer-events-none / preserveAspectRatio=none)', async () => {
    const chunks: AnalyzingChunk[] = []
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const svg = container.querySelector('[data-testid="citation-overlay"]')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('none')
    const cls = svg!.getAttribute('class') ?? ''
    expect(cls).toContain('absolute')
    expect(cls).toContain('inset-0')
    expect(cls).toContain('z-10')
    expect(cls).toContain('pointer-events-none')
  })
})

// ============================================================================
// chunks → paths 派生
// ============================================================================

describe('CitationOverlay · chunks → paths', () => {
  it('空 chunks → 0 条 path', async () => {
    const { container } = render(<TestHarness chunks={[]} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(0)
  })

  it('1 subproblem + 1 source_ref → 1 条 path', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'prd', lineRange: [2, 3] }],
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(1)
    expect(
      container.querySelector('[data-testid="citation-overlay"]')!.getAttribute(
        'data-line-count',
      ),
    ).toBe('1')
  })

  it('1 subproblem + 2 source_refs → 2 条 path(共享源点 product)', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [
          { kind: 'prd', lineRange: [2, 3] },
          { kind: 'prd', lineRange: [4, 5] },
        ],
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(2)
  })

  it('narration chunk 无 source_ref → 0 条 path(契约:source_refs 在 narration 上省略)', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'n-1',
        ts: '14:23:01',
        label: 'START',
        text: '开始',
        kind: 'narration',
        tone: 'info',
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(0)
  })

  it('asset ref 无 lineRange → 不画线(锚点缺失自然跳过)', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'asset', assetId: 'flow.png' }],
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    // asset ref 没有 lineRange → markMap 查不到对应 mark → 不画线
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(0)
  })

  it('aux ref + activeTabId 不匹配 → 0 条 path(只画当前 tab 可见的线)', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'aux', auxId: 'aux-api', lineRange: [2, 3] }],
      },
    ]
    // active tab = 'prd' → 不匹配 aux-api ref
    const { container } = render(
      <TestHarness chunks={chunks} activeTabId="prd" />,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(0)
  })

  it('切到 aux Tab(activeTabId="aux-api")→ aux ref 命中 → 1 条 path', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'aux', auxId: 'aux-api', lineRange: [2, 3] }],
      },
    ]
    const { container } = render(
      <TestHarness chunks={chunks} activeTabId="aux-api" />,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(1)
  })
})

// ============================================================================
// 位置 API(D2 · data-product-id / citation-highlight)
// ============================================================================

describe('CitationOverlay · 位置 API 锚点对齐', () => {
  it('product 卡片 DOM 加 data-product-id(ProductList 已实装;本测试通过 mock 验证 CitationOverlay 实际查它)', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'prd', lineRange: [2, 3] }],
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    // mock product 卡片存在 data-product-id
    expect(
      container.querySelector('[data-product-id="q-1"]'),
    ).not.toBeNull()
    // CitationOverlay 把它作为源点 → 画线 1 条
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(1)
  })

  it('mark span 带 data-line-start / data-line-end;CitationOverlay 按这两个属性匹配 ref', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'prd', lineRange: [2, 3] }],
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const marks = container.querySelectorAll('[data-testid="citation-highlight"]')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].getAttribute('data-line-start')).toBe('2')
    expect(marks[0].getAttribute('data-line-end')).toBe('3')
  })

  it('product 卡片缺失 → 不画线(产品尚未出现时不报错)', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'orphan',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'orphan',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'prd', lineRange: [2, 3] }],
      },
    ]
    function EmptyProductHarness() {
      const productListRef = useRef<HTMLDivElement>(null)
      const docPaneRef = useRef<HTMLDivElement>(null)
      return (
        <div>
          <div data-testid="empty-product-list" ref={productListRef} />
          <div
            data-testid="document-reader-pane"
            ref={docPaneRef}
            data-active-tab-id="prd"
          >
            <div data-testid="doc-reader-body">
              <mark
                data-testid="citation-highlight"
                data-line-start={2}
                data-line-end={3}
              >
                mark
              </mark>
            </div>
          </div>
          <CitationOverlay
            chunks={chunks}
            productListRef={productListRef as RefObject<HTMLElement | null>}
            documentBodyRef={docPaneRef as RefObject<HTMLElement | null>}
            isDesktop={true}
          />
        </div>
      )
    }
    const { container } = render(<EmptyProductHarness />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(
      container.querySelectorAll('[data-testid="citation-overlay-line"]'),
    ).toHaveLength(0)
  })
})

// ============================================================================
// SSR / 窄视口容错
// ============================================================================

describe('CitationOverlay · SSR / 窄视口容错', () => {
  it('窄视口(isDesktop=false)→ 不渲染 SVG', async () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: '14:23:01',
        label: 'DETECT',
        text: 'Q1',
        kind: 'subproblem',
        tone: 'info',
        source_refs: [{ kind: 'prd', lineRange: [2, 3] }],
      },
    ]
    const { container } = render(<TestHarness chunks={chunks} isDesktop={false} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(container.querySelector('[data-testid="citation-overlay"]')).toBeNull()
  })

  it('桌面形态 + mounted → 渲染 SVG(可重渲染多次不崩)', async () => {
    const chunks: AnalyzingChunk[] = []
    const { rerender } = render(<TestHarness chunks={chunks} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    rerender(<TestHarness chunks={chunks} />)
    expect(
      document.querySelector('[data-testid="citation-overlay"]'),
    ).not.toBeNull()
  })
})