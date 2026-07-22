/**
 * analyzing-zone-synthetic.test.tsx —— ticket 04 zone 集成验收(ADR-0017 D6)
 *
 * 覆盖:
 * 1. 用户在 ProductList 加 product → 合成 synthetic chunk 落到 chunksBySessionId
 *    → 新卡片渲染(data-synthetic="true")
 * 2. 无出处 synthetic 卡片显示 "⚠️ 无出处" 角标
 * 3. 点击无出处卡片 → 弹 toast "未关联原文出处"(复用 ticket 03 路径)
 *
 * updateProduct(server action)被 mock 成 no-op 成功,以隔离 server 端 IO /
 * revalidatePath —— 本 ticket synthetic chunk 是"额外的客户端通知",与 server
 * action 解耦。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyzingZone } from '@/components/analyzing-zone'
import { emptyAnalyzing, type AnalyzingData } from '@/lib/analyzing'

vi.mock('@/lib/products-actions', () => ({
  updateProduct: vi.fn().mockResolvedValue({ ok: true }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** active 数据,空 chunks(首次进入 ANALYZING),有 PRD 全文 */
function makeActiveData(): AnalyzingData {
  return {
    ...emptyAnalyzing('req-synthetic'),
    empty: false,
    phase: 'active',
    prdMarkdown: ['# 退款', '', '正文'].join('\n'),
    chunks: [],
    stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
  }
}

describe('AnalyzingZone · synthetic chunk 集成(ticket 04)', () => {
  it('加 product → 合成 synthetic 卡片渲染(data-synthetic + 无出处角标)', async () => {
    const user = userEvent.setup()
    render(<AnalyzingZone data={makeActiveData()} />)

    // 初始无子问题卡片
    expect(screen.queryByTestId('product-subproblems-item')).toBeNull()

    // 打开新增对话框 → 输入标题 → 确认(不选出处)
    await user.click(screen.getByTestId('product-add-subproblems'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), 'Q · 用户手加子问题')
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    // 合成 chunk 落 chunksBySessionId → deriveProducts → 新卡片出现
    const card = await screen.findByTestId('product-subproblems-item')
    expect(card.getAttribute('data-synthetic')).toBe('true')
    expect(card.textContent).toContain('Q · 用户手加子问题')
    // 无 source_refs → 角标 ⚠️ 无出处
    expect(within(card).getByTestId('citation-missing')).toBeInTheDocument()
  })

  it('点击无出处 synthetic 卡片 → 弹 toast "未关联原文出处"', async () => {
    const user = userEvent.setup()
    render(<AnalyzingZone data={makeActiveData()} />)

    await user.click(screen.getByTestId('product-add-risks'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), '用户手加风险')
    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    const card = await screen.findByTestId('product-risks-item')
    expect(card.getAttribute('data-synthetic')).toBe('true')

    await user.click(card)
    expect(screen.getByText(/未关联原文出处/)).toBeInTheDocument()
  })
})
