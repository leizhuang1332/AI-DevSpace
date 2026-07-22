/**
 * analyzing-product-synthetic.test.tsx —— ticket 04 组件级验收(ADR-0017 D6)
 *
 * 覆盖 ProductList 的 synthetic chunk 集成:
 * 1. `onAddSyntheticChunk` 回调触发 + 参数形态正确(id / label / kind / synthetic)
 * 2. 卡片 `data-synthetic="true"` 渲染
 * 3. `citation-missing` 角标显示条件(synthetic 且无 source_refs → 显示;否则不显示)
 * 4. AddDialog "关联出处" 选择器:选 PRD / aux → 合成 chunk 带 source_refs
 * 5. 向后兼容:不传 onAddSyntheticChunk → 仍走 onAction,不崩
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ProductList,
  type CitationSourceOption,
} from '@/components/product-list'
import type { AnalyzingChunk, AnalyzingProductGroup } from '@/lib/analyzing'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const noopAsync = async (): Promise<void> => {
  /* no-op */
}

function emptyGroup(): AnalyzingProductGroup {
  return { subproblems: [], risks: [], options: [] }
}

// ============================================================================
// onAddSyntheticChunk 回调
// ============================================================================

describe('ProductList · onAddSyntheticChunk 回调', () => {
  it('新增 product 提交 → onAddSyntheticChunk 收到形态正确的 synthetic chunk', async () => {
    const user = userEvent.setup()
    const onAddSyntheticChunk = vi.fn()
    render(
      <ProductList
        products={emptyGroup()}
        onAction={noopAsync}
        onAddSyntheticChunk={onAddSyntheticChunk}
      />,
    )

    await user.click(screen.getByTestId('product-add-risks'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), '并发退款风险')
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    expect(onAddSyntheticChunk).toHaveBeenCalledTimes(1)
    const chunk = onAddSyntheticChunk.mock.calls[0][0] as AnalyzingChunk
    expect(chunk.synthetic).toBe(true)
    expect(chunk.kind).toBe('risk')
    expect(chunk.label).toBe('RISK')
    expect(chunk.text).toBe('并发退款风险')
    expect(chunk.id.startsWith('user-added-')).toBe(true)
    expect(chunk.tone).toBe('info')
    // 未选出处 → source_refs 省略
    expect('source_refs' in chunk).toBe(false)
  })

  it('不传 onAddSyntheticChunk → 仍调 onAction,不合成 chunk(向后兼容)', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={emptyGroup()} onAction={onAction} />)

    await user.click(screen.getByTestId('product-add-subproblems'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), 'Q · 新问题')
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0][0].action).toBe('add')
  })
})

// ============================================================================
// AddDialog "关联出处" 选择器
// ============================================================================

describe('ProductList · AddDialog 关联出处', () => {
  const citationSources: CitationSourceOption[] = [
    { value: 'prd', label: 'PRD 需求文档', kind: 'prd' },
    { value: 'aux-api', label: 'api-refund.md', kind: 'aux', auxId: 'aux-api' },
  ]

  it('不传 citationSources → 无出处选择器', async () => {
    const user = userEvent.setup()
    render(<ProductList products={emptyGroup()} onAction={noopAsync} onAddSyntheticChunk={vi.fn()} />)
    await user.click(screen.getByTestId('product-add-subproblems'))
    expect(screen.queryByTestId('product-add-citation-toggle')).toBeNull()
  })

  it('选 PRD + 行范围 → 合成 chunk 带 prd source_ref', async () => {
    const user = userEvent.setup()
    const onAddSyntheticChunk = vi.fn()
    render(
      <ProductList
        products={emptyGroup()}
        onAction={noopAsync}
        onAddSyntheticChunk={onAddSyntheticChunk}
        citationSources={citationSources}
      />,
    )

    await user.click(screen.getByTestId('product-add-options'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), 'C · 带出处方案')
    // 开启出处 → 选文档 → 设行范围
    await user.click(within(dialog).getByTestId('product-add-citation-toggle'))
    await user.selectOptions(within(dialog).getByTestId('product-add-citation-doc'), 'prd')
    const start = within(dialog).getByTestId('product-add-citation-start')
    const end = within(dialog).getByTestId('product-add-citation-end')
    await user.clear(start)
    await user.type(start, '10')
    await user.clear(end)
    await user.type(end, '20')
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    const chunk = onAddSyntheticChunk.mock.calls[0][0] as AnalyzingChunk
    expect(chunk.source_refs).toEqual([{ kind: 'prd', lineRange: [10, 20] }])
  })

  it('选 aux → 合成 chunk 带 aux source_ref(auxId 正确)', async () => {
    const user = userEvent.setup()
    const onAddSyntheticChunk = vi.fn()
    render(
      <ProductList
        products={emptyGroup()}
        onAction={noopAsync}
        onAddSyntheticChunk={onAddSyntheticChunk}
        citationSources={citationSources}
      />,
    )

    await user.click(screen.getByTestId('product-add-subproblems'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), 'Q · aux 出处')
    await user.click(within(dialog).getByTestId('product-add-citation-toggle'))
    await user.selectOptions(within(dialog).getByTestId('product-add-citation-doc'), 'aux-api')
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    const chunk = onAddSyntheticChunk.mock.calls[0][0] as AnalyzingChunk
    expect(chunk.source_refs).toEqual([
      { kind: 'aux', auxId: 'aux-api', lineRange: [0, 1] },
    ])
  })

  it('开启出处但未选文档 → source_refs 省略(角标 ⚠️ 路径)', async () => {
    const user = userEvent.setup()
    const onAddSyntheticChunk = vi.fn()
    render(
      <ProductList
        products={emptyGroup()}
        onAction={noopAsync}
        onAddSyntheticChunk={onAddSyntheticChunk}
        citationSources={citationSources}
      />,
    )

    await user.click(screen.getByTestId('product-add-risks'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), '无出处风险')
    await user.click(within(dialog).getByTestId('product-add-citation-toggle'))
    // 不选文档直接确认
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    const chunk = onAddSyntheticChunk.mock.calls[0][0] as AnalyzingChunk
    expect('source_refs' in chunk).toBe(false)
  })
})

// ============================================================================
// data-synthetic + citation-missing 角标
// ============================================================================

describe('ProductList · data-synthetic + 无出处角标', () => {
  it('synthetic 且无 source_refs → 卡片 data-synthetic="true" + citation-missing 角标', () => {
    const products: AnalyzingProductGroup = {
      subproblems: [{ id: 'user-added-1', title: '用户加的', severity: 'blue', synthetic: true }],
      risks: [],
      options: [],
    }
    render(<ProductList products={products} onAction={noopAsync} />)
    const card = screen.getByTestId('product-subproblems-item')
    expect(card.getAttribute('data-synthetic')).toBe('true')
    expect(within(card).getByTestId('citation-missing')).toBeInTheDocument()
    expect(within(card).getByTestId('citation-missing').getAttribute('title')).toBe(
      '该产物未关联原文出处',
    )
  })

  it('synthetic 且有 source_refs → 无角标', () => {
    const products: AnalyzingProductGroup = {
      subproblems: [
        {
          id: 'user-added-2',
          title: '有出处',
          severity: 'blue',
          synthetic: true,
          source_refs: [{ kind: 'prd', lineRange: [0, 3] }],
        },
      ],
      risks: [],
      options: [],
    }
    render(<ProductList products={products} onAction={noopAsync} />)
    const card = screen.getByTestId('product-subproblems-item')
    expect(card.getAttribute('data-synthetic')).toBe('true')
    expect(within(card).queryByTestId('citation-missing')).toBeNull()
  })

  it('普通 AI 产出(非 synthetic)→ data-synthetic="false" 且无角标', () => {
    const products: AnalyzingProductGroup = {
      subproblems: [{ id: 'q1', title: 'AI 识别', severity: 'green' }],
      risks: [],
      options: [],
    }
    render(<ProductList products={products} onAction={noopAsync} />)
    const card = screen.getByTestId('product-subproblems-item')
    expect(card.getAttribute('data-synthetic')).toBe('false')
    expect(within(card).queryByTestId('citation-missing')).toBeNull()
  })
})
