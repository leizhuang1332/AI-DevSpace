import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssetMeta, AuxFile } from '@ai-devspace/shared'
import {
  DocumentReaderPane,
  PRD_TAB_ID,
  type DocumentReaderCitationCounts,
} from '../document-reader-pane'
import type { CitationRefsByDoc } from '@/lib/analyzing'

// ============================================================================
// Fixture factory
// ============================================================================

function makeAux(overrides: Partial<AuxFile> = {}): AuxFile {
  return {
    id: 'aux-api',
    filename: 'api-draft.md',
    body: '# API 草案\n\nPOST /api/refunds',
    usage_tag: 'api',
    source_format: 'md',
    converted_to_md: false,
    ...overrides,
  }
}

function makeCounts(
  overrides: Partial<DocumentReaderCitationCounts> = {},
): DocumentReaderCitationCounts {
  return {
    prd: 0,
    aux: {},
    asset: 0,
    ...overrides,
  }
}

function makeRefs(overrides: Partial<CitationRefsByDoc> = {}): CitationRefsByDoc {
  return { prd: [], aux: {}, asset: [], ...overrides }
}

/**
 * 用 querySelector 在当前 DOM 里取指定 tabId 的 Tab 按钮。
 * `screen.getByTestId` 不支持 CSS 选择器表达式,所以走 querySelector 兜底。
 * 用属性选择器精确匹配 data-tab-id(避免与 data-testid 混在一起)。
 */
function getTab(tabId: string): HTMLButtonElement {
  const root = document.body
  const el = root.querySelector<HTMLButtonElement>(
    `button[data-testid="doc-reader-tab"][data-tab-id="${CSS.escape(tabId)}"]`,
  )
  if (!el) throw new Error(`Tab not found: ${tabId}`)
  return el
}

const emptyAssets: AssetMeta[] = []

afterEach(() => {
  cleanup()
})

// ============================================================================
// 渲染骨架(ticket 02 验收 · 基础)
// ============================================================================

describe('DocumentReaderPane · 渲染骨架', () => {
  it('根节点 testid + Tab 栏 + 阅读区 testid 齐备', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="# hello"
        auxFiles={[]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(screen.getByTestId('document-reader-pane')).toBeInTheDocument()
    expect(screen.getByTestId('doc-reader-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('doc-reader-body')).toBeInTheDocument()
  })

  it('Tab 栏 role="tablist";阅读区 role="tabpanel"', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="hi"
        auxFiles={[]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(screen.getByTestId('doc-reader-tabs').getAttribute('role')).toBe('tablist')
    expect(screen.getByTestId('doc-reader-body').getAttribute('role')).toBe('tabpanel')
  })

  it('data-active-tab-id 默认 = "prd"', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="hi"
        auxFiles={[makeAux()]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe(PRD_TAB_ID)
  })
})

// ============================================================================
// 空态(ticket 02 验收 · AC "空态")
// ============================================================================

describe('DocumentReaderPane · 空态', () => {
  it('prdMarkdown === "" && auxFiles.length === 0 → 显示"暂无需求文档与辅助材料"占位', () => {
    render(
      <DocumentReaderPane
        prdMarkdown=""
        auxFiles={[]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const body = screen.getByTestId('doc-reader-body')
    expect(body.textContent).toContain('暂无需求文档与辅助材料')
    expect(screen.getByTestId('doc-reader-empty')).toBeInTheDocument()
    // MarkdownPreview 不应渲染
    expect(screen.queryByTestId('markdown-preview')).toBeNull()
  })

  it('只有 auxFiles(无 prd)→ 不算空态,默认 PRD Tab 但可切到 aux 看到内容', async () => {
    const user = userEvent.setup()
    render(
      <DocumentReaderPane
        prdMarkdown=""
        auxFiles={[makeAux()]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(screen.queryByTestId('doc-reader-empty')).toBeNull()
    // 默认 active = PRD,但 PRD body 空 → MarkdownPreview 容器存在但无 block
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    // 切到 aux → 渲染 aux 内容
    await user.click(getTab('aux-api'))
    expect(screen.getByTestId('markdown-preview').textContent).toContain('API 草案')
  })

  it('只有 prdMarkdown(无 auxFiles)→ 不算空态,渲染 MarkdownPreview', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="# 退款功能\n\n正文"
        auxFiles={[]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(screen.queryByTestId('doc-reader-empty')).toBeNull()
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
  })
})

// ============================================================================
// 单 PRD 渲染(只有 prdMarkdown)
// ============================================================================

describe('DocumentReaderPane · 单 PRD 渲染', () => {
  it('只渲染 PRD Tab', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0].getAttribute('data-tab-id')).toBe(PRD_TAB_ID)
    expect(tabs[0].getAttribute('data-tab-kind')).toBe('prd')
  })

  it('MarkdownPreview 接收 prdMarkdown 全文', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="# 标题\n\n内容"
        auxFiles={[]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const preview = screen.getByTestId('markdown-preview')
    expect(preview.textContent).toContain('标题')
    expect(preview.textContent).toContain('内容')
    // currentFile = "requirement.md"
    expect(preview.getAttribute('data-current-file')).toBe('requirement.md')
  })
})

// ============================================================================
// PRD + AuxFile 渲染,默认 Tab = PRD(ticket 02 验收 · AC)
// ============================================================================

describe('DocumentReaderPane · PRD + AuxFile,默认 Tab = PRD', () => {
  const aux1 = makeAux({
    id: 'aux-api',
    filename: 'api-draft.md',
    body: '# API 草案\n\nPOST /api/refunds',
  })
  const aux2 = makeAux({
    id: 'aux-data',
    filename: 'data-model.md',
    body: '# Data\n\n`orders(id, amount)`',
    usage_tag: 'data',
  })

  it('Tab 列表 = [PRD, aux1, aux2],顺序保持 auxFiles 入参顺序', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux1, aux2]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs.map((t) => t.getAttribute('data-tab-id'))).toEqual([
      PRD_TAB_ID,
      'aux-api',
      'aux-data',
    ])
  })

  it('初始 active = PRD;正文渲染 prdMarkdown', () => {
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux1, aux2]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(screen.getByTestId('markdown-preview').textContent).toContain('PRD')
    // 初始不应渲染 aux 的 body
    expect(screen.queryByText('API 草案')).toBeNull()
  })

  it('点击 AuxFile Tab → 切到 aux;正文渲染对应 body', async () => {
    const user = userEvent.setup()
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux1, aux2]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    await user.click(getTab('aux-api'))
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
    // MarkdownPreview 切换到 aux1 body
    const preview = screen.getByTestId('markdown-preview')
    expect(preview.textContent).toContain('API 草案')
    expect(preview.textContent).toContain('POST /api/refunds')
    // currentFile 应是 aux1.filename
    expect(preview.getAttribute('data-current-file')).toBe('api-draft.md')
  })

  it('点击 PRD Tab 后再点 PRD → 仍 active(幂等)', async () => {
    const user = userEvent.setup()
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux1]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    await user.click(getTab('aux-api'))
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
    await user.click(getTab('prd'))
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('prd')
  })

  it('切换 aux 后再切回 PRD → body 切回 prdMarkdown', async () => {
    const user = userEvent.setup()
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD 标题"
        auxFiles={[aux1]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    await user.click(getTab('aux-api'))
    expect(screen.getByTestId('markdown-preview').textContent).toContain('API 草案')
    await user.click(getTab('prd'))
    expect(screen.getByTestId('markdown-preview').textContent).toContain('PRD 标题')
  })
})

// ============================================================================
// 引用计数渲染(ticket 02 验收 · AC #4)
// ============================================================================

describe('DocumentReaderPane · 引用计数渲染', () => {
  it('PRD 引用 > 0 → "🔗 N";aux 引用 > 0 → "🔗 N"', () => {
    const aux = makeAux({ id: 'aux-api', filename: 'api.md' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts({ prd: 3, aux: { 'aux-api': 2 } })}
      />,
    )
    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs[0].textContent).toBe('PRD · 🔗 3')
    expect(tabs[1].textContent).toBe('api.md · 🔗 2')
  })

  it('PRD 引用 = 0 且 aux 引用 = 0 → 只显示中性"·",不带 🔗 数字', () => {
    const aux = makeAux({ id: 'aux-api', filename: 'api.md' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts({ prd: 0, aux: {} })}
      />,
    )
    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs[0].textContent).toBe('PRD ·')
    expect(tabs[1].textContent).toBe('api.md ·')
    expect(tabs[0].textContent).not.toContain('🔗')
    expect(tabs[1].textContent).not.toContain('🔗')
  })

  it('PRD 引用 > 0 + aux 引用 = 0 → 混合(PRD 有 🔗 N,aux 只显示 ·)', () => {
    const aux = makeAux({ id: 'aux-api', filename: 'api.md' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts({ prd: 5, aux: {} })}
      />,
    )
    const tabs = screen.getAllByTestId('doc-reader-tab')
    expect(tabs[0].textContent).toBe('PRD · 🔗 5')
    expect(tabs[1].textContent).toBe('api.md ·')
  })

  it('aux 缺省(没在 citationCounts.aux 里)→ 该 Tab 视为 0', () => {
    const aux = makeAux({ id: 'aux-orphan', filename: 'orphan.md' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts({ aux: {} })}
      />,
    )
    const tab = getTab('aux-orphan')
    expect(tab.textContent).toBe('orphan.md ·')
    expect(tab.textContent).not.toContain('🔗')
  })
})

// ============================================================================
// activeSourceRef / onSourceRefClick 接口位(ticket 03 接入,本期不消费)
// ============================================================================

describe('DocumentReaderPane · activeSourceRef / onSourceRefClick(本期保留接口位)', () => {
  it('传 activeSourceRef 不报错(本期不消费)', () => {
    expect(() =>
      render(
        <DocumentReaderPane
          prdMarkdown="# PRD"
          auxFiles={[]}
          assetList={emptyAssets}
          citationCounts={makeCounts()}
          activeSourceRef={{ kind: 'prd', lineRange: [0, 1] }}
        />,
      ),
    ).not.toThrow()
  })

  it('传 onSourceRefClick 不报错(本期不消费)', () => {
    const onClick = vi.fn()
    expect(() =>
      render(
        <DocumentReaderPane
          prdMarkdown="# PRD"
          auxFiles={[]}
          assetList={emptyAssets}
          citationCounts={makeCounts()}
          onSourceRefClick={onClick}
        />,
      ),
    ).not.toThrow()
  })
})

// ============================================================================
// a11y + 键盘 ← →(ticket 02 验收 · AC #3)
// ============================================================================

describe('DocumentReaderPane · a11y + 键盘 ← → 切换 Tab', () => {
  it('Tab 按钮 aria-selected 反映 active 状态', () => {
    const aux = makeAux({ id: 'aux-api' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const prdTab = getTab('prd')
    const auxTab = getTab('aux-api')
    expect(prdTab.getAttribute('aria-selected')).toBe('true')
    expect(auxTab.getAttribute('aria-selected')).toBe('false')
    expect(prdTab.getAttribute('role')).toBe('tab')
    expect(auxTab.getAttribute('role')).toBe('tab')
  })

  it('Tab 按钮 data-active 反映 active 状态(ticket 02 spec)', () => {
    const aux = makeAux({ id: 'aux-api' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const prdTab = getTab('prd')
    const auxTab = getTab('aux-api')
    expect(prdTab.getAttribute('data-active')).toBe('true')
    expect(auxTab.getAttribute('data-active')).toBe('false')
  })

  it('Tab 按钮 id 与 tabpanel aria-labelledby 配对(a11y)', () => {
    const aux = makeAux({ id: 'aux-api' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const prdTab = getTab('prd')
    expect(prdTab.getAttribute('id')).toBe('doc-reader-tab-prd')
    const panel = screen.getByTestId('doc-reader-body')
    expect(panel.getAttribute('aria-labelledby')).toBe('doc-reader-tab-prd')
  })

  it('键盘 ArrowRight → 切到下一个 Tab', () => {
    const aux = makeAux({ id: 'aux-api' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const tablist = screen.getByTestId('doc-reader-tabs')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
  })

  it('键盘 ArrowLeft 在第一个 Tab → 回卷到最后一个 Tab', () => {
    const aux = makeAux({ id: 'aux-api' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const tablist = screen.getByTestId('doc-reader-tabs')
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
  })

  it('键盘 ArrowRight 在最后一个 Tab → 回卷到第一个 Tab(PRD)', () => {
    const aux = makeAux({ id: 'aux-api' })
    render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[aux]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    const tablist = screen.getByTestId('doc-reader-tabs')
    // 先切到 aux
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
    // 再按 → 应回卷到 PRD
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('prd')
  })
})

// ============================================================================
// 容错:auxFiles 缩减后 activeTabId 失效 → 回退 PRD
// ============================================================================

describe('DocumentReaderPane · 容错', () => {
  it('activeTabId 指向已不存在的 aux(SSR re-render 后) → 静默回退到 PRD', () => {
    const { rerender } = render(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[
          makeAux({ id: 'aux-api', filename: 'api.md' }),
          makeAux({ id: 'aux-data', filename: 'data.md', usage_tag: 'data' }),
        ]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    // 先切到 aux-data
    fireEvent.click(getTab('aux-data'))
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-data')
    // aux-data 不再存在 → 回退到 PRD
    rerender(
      <DocumentReaderPane
        prdMarkdown="# PRD"
        auxFiles={[makeAux({ id: 'aux-api', filename: 'api.md' })]}
        assetList={emptyAssets}
        citationCounts={makeCounts()}
      />,
    )
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe(PRD_TAB_ID)
  })
})

// ============================================================================
// Asset 渲染(图片通过 MarkdownPreview 自然处理)
// ============================================================================

describe('DocumentReaderPane · Asset 内联', () => {
  it('PRD 含 ![](assets/foo.png) → MarkdownPreview 解析 assets', () => {
    const assets: AssetMeta[] = [
      {
        name: 'foo.png',
        url: '/api/requirement/req-1/assets/foo.png',
        path: 'requirements/req-1/assets/foo.png',
        size: 100,
        mime: 'image/png',
      },
    ]
    render(
      <DocumentReaderPane
        prdMarkdown="![示例](assets/foo.png)"
        auxFiles={[]}
        assetList={assets}
        citationCounts={makeCounts()}
      />,
    )
    const img = screen.getByTestId('md-preview-image')
    expect(img.getAttribute('src')).toBe('/api/requirement/req-1/assets/foo.png')
  })
})

// ============================================================================
// 画线高亮渲染(ticket 03 · ADR-0017 D4)
// ============================================================================

// 5 行 PRD:heading[0,1) / 段落A[2,3) / 段落B[4,5)
const PRD_5LINE = ['# 标题', '', '段落A', '', '段落B'].join('\n')

describe('DocumentReaderPane · 画线高亮渲染', () => {
  it('citation-highlight 数量与去重后的 source_ref span 一致(2 条不同 span → 2 个 mark)', () => {
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[]}
        assetList={[]}
        citationCounts={makeCounts({ prd: 2 })}
        citationRefs={makeRefs({
          prd: [
            { kind: 'prd', lineRange: [2, 3] },
            { kind: 'prd', lineRange: [4, 5] },
          ],
        })}
      />,
    )
    expect(screen.getAllByTestId('citation-highlight')).toHaveLength(2)
  })

  it('多产物引用同一 span → 一个 mark,data-refs-count 显示总数', () => {
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[]}
        assetList={[]}
        citationCounts={makeCounts({ prd: 3 })}
        citationRefs={makeRefs({
          prd: [
            { kind: 'prd', lineRange: [2, 3] },
            { kind: 'prd', lineRange: [2, 3] },
            { kind: 'prd', lineRange: [2, 3] },
          ],
        })}
      />,
    )
    const marks = screen.getAllByTestId('citation-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0].getAttribute('data-refs-count')).toBe('3')
  })

  it('lineRange 越界 → 该 source_ref 不渲染(不报错)', () => {
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[]}
        assetList={[]}
        citationCounts={makeCounts({ prd: 1 })}
        citationRefs={makeRefs({
          prd: [{ kind: 'prd', lineRange: [99, 100] }],
        })}
      />,
    )
    expect(screen.queryAllByTestId('citation-highlight')).toHaveLength(0)
  })

  it('无 citationRefs → 无高亮(与 ticket 02 行为一致)', () => {
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[]}
        assetList={[]}
        citationCounts={makeCounts()}
      />,
    )
    expect(screen.queryAllByTestId('citation-highlight')).toHaveLength(0)
  })

  it('hover 高亮 → 浮 tooltip 出现;移出 → tooltip 消失', () => {
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[]}
        assetList={[]}
        citationCounts={makeCounts({ prd: 2 })}
        citationRefs={makeRefs({
          prd: [
            { kind: 'prd', lineRange: [2, 3] },
            { kind: 'prd', lineRange: [2, 3] },
          ],
        })}
      />,
    )
    const mark = screen.getByTestId('citation-highlight')
    expect(screen.queryByTestId('citation-tooltip')).toBeNull()
    fireEvent.mouseEnter(mark)
    const tip = screen.getByTestId('citation-tooltip')
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(tip.textContent).toContain('被 2 个产物引用')
    fireEvent.mouseLeave(mark)
    expect(screen.queryByTestId('citation-tooltip')).toBeNull()
  })

  it('quote 与 lineRange 文本不一致 → data-quote-mismatch=true,tooltip 带 ⚠️', () => {
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[]}
        assetList={[]}
        citationCounts={makeCounts({ prd: 1 })}
        citationRefs={makeRefs({
          prd: [{ kind: 'prd', lineRange: [2, 3], quote: '对不上的原文' }],
        })}
      />,
    )
    const mark = screen.getByTestId('citation-highlight')
    expect(mark.getAttribute('data-quote-mismatch')).toBe('true')
    fireEvent.mouseEnter(mark)
    expect(screen.getByTestId('citation-tooltip').textContent).toContain('⚠️')
  })

  it('Asset 被引用 → 图片加 ring + "🔗 N" 角标', () => {
    const assets: AssetMeta[] = [
      {
        name: 'flow.png',
        url: '/api/requirement/req-1/assets/flow.png',
        path: 'requirements/req-1/assets/flow.png',
        size: 100,
        mime: 'image/png',
      },
    ]
    render(
      <DocumentReaderPane
        prdMarkdown="![流程](assets/flow.png)"
        auxFiles={[]}
        assetList={assets}
        citationCounts={makeCounts({ asset: 2 })}
        citationRefs={makeRefs({
          asset: [
            { kind: 'asset', assetId: 'flow.png' },
            { kind: 'asset', assetId: 'flow.png' },
          ],
        })}
      />,
    )
    expect(screen.getByTestId('asset-citation').getAttribute('data-asset-refs-count')).toBe('2')
    expect(screen.getByTestId('asset-citation-badge').textContent).toContain('🔗 2')
    expect(screen.getByTestId('md-preview-image').className).toContain('ring-brand-300')
  })

  it('AuxFile Tab 的高亮按 citationRefs.aux[activeTabId] 过滤', async () => {
    const user = userEvent.setup()
    const aux = makeAux({ id: 'aux-api', filename: 'api.md', body: 'aux行0\n\naux行2' })
    render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[aux]}
        assetList={[]}
        citationCounts={makeCounts({ prd: 1, aux: { 'aux-api': 1 } })}
        citationRefs={makeRefs({
          prd: [{ kind: 'prd', lineRange: [2, 3] }],
          aux: { 'aux-api': [{ kind: 'aux', auxId: 'aux-api', lineRange: [0, 1] }] },
        })}
      />,
    )
    // PRD tab:1 个高亮(prd span)
    expect(screen.getAllByTestId('citation-highlight')).toHaveLength(1)
    // 切到 aux → aux 的高亮(1 个)
    await user.click(
      document.querySelector<HTMLButtonElement>(
        'button[data-testid="doc-reader-tab"][data-tab-id="aux-api"]',
      )!,
    )
    expect(screen.getAllByTestId('citation-highlight')).toHaveLength(1)
    expect(screen.getByTestId('citation-highlight').getAttribute('data-line-start')).toBe('0')
  })
})

// ============================================================================
// pulseRef 联动:切 Tab + 滚 + pulse class(ticket 03 · ADR-0017 D4)
// ============================================================================

describe('DocumentReaderPane · pulseRef 联动', () => {
  beforeEach(() => {
    // jsdom 未实现 scrollIntoView;桩掉以便断言"滚"被调用
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.HTMLElement.prototype as any).scrollIntoView = vi.fn()
  })

  it('pulseRef.tabId ≠ 当前 → 切 Tab + 滚 + 命中 mark 加 animate-pulse-brand;1.5s 后移除', () => {
    vi.useFakeTimers()
    const scrollSpy = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.HTMLElement.prototype as any).scrollIntoView = scrollSpy

    const aux = makeAux({ id: 'aux-api', filename: 'api.md', body: 'aux行0\n\naux行2' })
    const refs = makeRefs({
      aux: { 'aux-api': [{ kind: 'aux', auxId: 'aux-api', lineRange: [0, 1] }] },
    })
    const { rerender } = render(
      <DocumentReaderPane
        prdMarkdown={PRD_5LINE}
        auxFiles={[aux]}
        assetList={[]}
        citationCounts={makeCounts({ aux: { 'aux-api': 1 } })}
        citationRefs={refs}
        pulseRef={null}
      />,
    )
    // 初始 active = PRD
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe(PRD_TAB_ID)

    // 触发 pulseRef → 切到 aux-api tab
    act(() => {
      rerender(
        <DocumentReaderPane
          prdMarkdown={PRD_5LINE}
          auxFiles={[aux]}
          assetList={[]}
          citationCounts={makeCounts({ aux: { 'aux-api': 1 } })}
          citationRefs={refs}
          pulseRef={{ tabId: 'aux-api', lineRange: [0, 1] }}
        />,
      )
    })
    // 切 Tab
    expect(
      screen.getByTestId('document-reader-pane').getAttribute('data-active-tab-id'),
    ).toBe('aux-api')
    // 命中 mark 加 pulse class
    const mark = screen.getByTestId('citation-highlight')
    expect(mark.className).toContain('animate-pulse-brand')

    // 滚(setTimeout 0)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(scrollSpy).toHaveBeenCalled()

    // 1.5s 后 pulse class 移除
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(
      screen.getByTestId('citation-highlight').className,
    ).not.toContain('animate-pulse-brand')

    vi.useRealTimers()
  })
})