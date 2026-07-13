/**
 * ProductList 交互态单元测试(issue 19d · VS4 验收)
 *
 * 覆盖:
 * - 卡片显示 3 个图标按钮(✏️ / 🗑 / 🔗)
 * - 编辑态切换:input 出现 + ✓ 保存 / ✕ 取消 按钮
 * - 空 title 时 ✓ 保存 按钮 disabled
 * - 删除确认态:变红边框 + 确认删除? + ✓ 是 / ✕ 否
 * - 合并模式:复选框 + 底部 [合并 N 项] 按钮(< 2 选中时 disabled)
 * - 新增输入框(title 必填验证)
 * - editable=false → 回退到只读模式(不破坏 VS2 测试)
 *
 * 不破坏 VS2:
 * - VS2 用例 "只读约束" 改为显式传 editable={false}
 * - 其他 VS2 渲染测试不依赖 editable prop
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductList } from '@/components/product-list'
import type { AnalyzingProductGroup } from '@/lib/analyzing'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function sampleGroup(): AnalyzingProductGroup {
  return {
    subproblems: [
      { id: 'q1', title: 'Q1 · 退款金额上限?', severity: 'green' },
      { id: 'q2', title: 'Q2 · 退款审核流?', severity: 'green' },
      { id: 'q3', title: 'Q3 · 退款失败回滚?', severity: 'green' },
    ],
    risks: [
      { id: 'r1', title: '高并发退款重复创建', severity: 'orange' },
    ],
    options: [
      { id: 'o1', title: 'A · 同步单阶段', severity: 'blue' },
      { id: 'o2', title: 'B · 异步多阶段', severity: 'blue' },
    ],
  }
}

const noopAsync = async (): Promise<void> => {
  /* no-op for tests */
}

// ============================================================================
// 默认行为:editable=true(默认),卡片显示 3 个图标按钮
// ============================================================================

describe('ProductList · 默认 editable=true', () => {
  it('卡片右上角显示 3 个图标按钮:✏️ / 🗑 / 🔗', () => {
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)
    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    expect(within(card).getByTestId('product-card-edit')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-delete')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-merge-toggle')).toBeInTheDocument()
  })

  it('每类底部有 + 新增 X 按钮', () => {
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)
    expect(screen.getByTestId('product-add-subproblems')).toBeInTheDocument()
    expect(screen.getByTestId('product-add-risks')).toBeInTheDocument()
    expect(screen.getByTestId('product-add-options')).toBeInTheDocument()
  })
})

// ============================================================================
// editable=false → 回退到只读模式(不破坏 VS2)
// ============================================================================

describe('ProductList · editable=false(只读)', () => {
  it('editable=false → 无图标按钮、无 + 新增按钮', () => {
    render(
      <ProductList
        products={sampleGroup()}
        editable={false}
        onAction={noopAsync}
      />,
    )
    expect(screen.queryByTestId('product-card-edit')).toBeNull()
    expect(screen.queryByTestId('product-card-delete')).toBeNull()
    expect(screen.queryByTestId('product-card-merge-toggle')).toBeNull()
    expect(screen.queryByTestId('product-add-subproblems')).toBeNull()
  })

  it('editable=false → 无任何 button(与 VS2 "只读约束" 等价)', () => {
    render(
      <ProductList
        products={sampleGroup()}
        editable={false}
        onAction={noopAsync}
      />,
    )
    expect(screen.getByTestId('product-list').querySelector('button')).toBeNull()
  })

  it('editable=undefined 也走 editable=true 路径(默认)', () => {
    render(<ProductList products={sampleGroup()} />)
    // 多个卡片都有 ✏️ 按钮 — 用 getAllByTestId 验证 ≥ 1
    expect(screen.getAllByTestId('product-card-edit').length).toBeGreaterThan(0)
    expect(screen.getByTestId('product-add-subproblems')).toBeInTheDocument()
  })
})

// ============================================================================
// 编辑态
// ============================================================================

describe('ProductList · 编辑态', () => {
  it('点 ✏️ → 卡片进入编辑态:input + ✓ 保存 + ✕ 取消', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    const editBtn = within(card).getByTestId('product-card-edit')

    await user.click(editBtn)

    // 编辑态元素出现
    expect(within(card).getByTestId('product-card-edit-input')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-save')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-cancel')).toBeInTheDocument()
    // 原始 title 文本不在该卡片内
    expect(within(card).queryByText('Q1 · 退款金额上限?')).toBeNull()
  })

  it('编辑态 input 预填当前 title', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    const input = within(card).getByTestId('product-card-edit-input') as HTMLInputElement
    expect(input.value).toBe('Q1 · 退款金额上限?')
  })

  it('编辑态空 title → ✓ 保存 disabled', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    const input = within(card).getByTestId('product-card-edit-input')
    await user.clear(input)

    const save = within(card).getByTestId('product-card-save')
    expect(save).toBeDisabled()
  })

  it('编辑态纯空白 title(空格)→ ✓ 保存 disabled', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    const input = within(card).getByTestId('product-card-edit-input')
    await user.clear(input)
    await user.type(input, '   ')

    const save = within(card).getByTestId('product-card-save')
    expect(save).toBeDisabled()
  })

  it('编辑态 input 有内容 → ✓ 保存 enabled', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    const save = within(card).getByTestId('product-card-save')
    expect(save).not.toBeDisabled()
  })

  it('点 ✓ 保存 → 调 onAction({action: edit, kind, id, patch:{title}})', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    const input = within(card).getByTestId('product-card-edit-input')
    await user.clear(input)
    await user.type(input, '新标题')

    await user.click(within(card).getByTestId('product-card-save'))

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({
      kind: 'subproblems',
      action: 'edit',
      id: 'q1',
      patch: { title: '新标题' },
    })
  })

  it('点 ✕ 取消 → 不调 onAction,卡片恢复显示态', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    await user.click(within(card).getByTestId('product-card-cancel'))

    expect(onAction).not.toHaveBeenCalled()
    // 卡片恢复:input 消失,原始 title 出现,3 按钮回来
    expect(within(card).queryByTestId('product-card-edit-input')).toBeNull()
    expect(within(card).getByText('Q1 · 退款金额上限?')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-edit')).toBeInTheDocument()
  })
})

// ============================================================================
// 删除确认态
// ============================================================================

describe('ProductList · 删除确认态', () => {
  it('点 🗑 → 卡片进入删除确认态:边框变红 + "确认删除?" + ✓ 是 / ✕ 否', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-delete'))

    expect(card.getAttribute('data-state')).toBe('confirm-delete')
    expect(card.className).toContain('border-error')
    expect(within(card).getByText('确认删除?')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-confirm-delete')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-cancel-delete')).toBeInTheDocument()
  })

  it('点 ✓ 是 → 调 onAction({action: delete, kind, id})', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-delete'))
    await user.click(within(card).getByTestId('product-card-confirm-delete'))

    expect(onAction).toHaveBeenCalledWith({
      kind: 'subproblems',
      action: 'delete',
      id: 'q1',
    })
  })

  it('点 ✕ 否 → 不调 onAction,卡片恢复显示态', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    const section = screen.getByTestId('product-subproblems')
    const card = within(section).getAllByTestId('product-subproblems-item')[0]
    await user.click(within(card).getByTestId('product-card-delete'))
    await user.click(within(card).getByTestId('product-card-cancel-delete'))

    expect(onAction).not.toHaveBeenCalled()
    expect(card.getAttribute('data-state')).toBe('normal')
  })
})

// ============================================================================
// 合并模式
// ============================================================================

describe('ProductList · 合并模式', () => {
  it('点 🔗 → 进入合并模式:其他同类卡片显示复选框,出现 [合并 N 项] 按钮', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    // 点 q1 的 merge 触发器,进入合并模式
    await user.click(within(cards[0]).getByTestId('product-card-merge-toggle'))

    // 底部出现 [合并 N 项] 按钮
    const mergeBar = screen.getByTestId('product-merge-bar')
    expect(mergeBar).toBeInTheDocument()
    expect(within(mergeBar).getByTestId('product-merge-submit')).toBeInTheDocument()
    expect(within(mergeBar).getByTestId('product-merge-cancel')).toBeInTheDocument()
    // 初始 0 选中,合并按钮 disabled
    expect(within(mergeBar).getByTestId('product-merge-submit')).toBeDisabled()

    // 所有同类卡片显示复选框
    for (const card of cards) {
      expect(within(card).getByTestId('product-merge-checkbox')).toBeInTheDocument()
    }
  })

  it('合并模式:勾选 N ≥ 2 → [合并 N 项] enabled,文案显示数字', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    // 进入合并模式:source (q1) 自动选中 → count=1
    await user.click(within(cards[0]).getByTestId('product-card-merge-toggle'))

    // 初始 count=1 → submit disabled
    let submit = within(screen.getByTestId('product-merge-bar')).getByTestId(
      'product-merge-submit',
    )
    expect(submit).toBeDisabled()
    expect(submit.textContent).toContain('1')

    // 勾选 q2 → count=2 → submit enabled
    await user.click(within(cards[1]).getByTestId('product-merge-checkbox'))
    submit = within(screen.getByTestId('product-merge-bar')).getByTestId(
      'product-merge-submit',
    )
    expect(submit).not.toBeDisabled()
    expect(submit.textContent).toContain('2')

    // 再勾 q3 → count=3
    await user.click(within(cards[2]).getByTestId('product-merge-checkbox'))
    submit = within(screen.getByTestId('product-merge-bar')).getByTestId(
      'product-merge-submit',
    )
    expect(submit).not.toBeDisabled()
    expect(submit.textContent).toContain('3')

    // 取消 q3 → count=2,仍 enabled
    await user.click(within(cards[2]).getByTestId('product-merge-checkbox'))
    submit = within(screen.getByTestId('product-merge-bar')).getByTestId(
      'product-merge-submit',
    )
    expect(submit).not.toBeDisabled()
    expect(submit.textContent).toContain('2')
  })

  it('点 [合并 N 项] → 弹对话框输入新 title,确认 → 调 onAction({action: merge, kind, ids})', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    await user.click(within(cards[0]).getByTestId('product-card-merge-toggle'))
    await user.click(within(cards[0]).getByTestId('product-merge-checkbox'))
    await user.click(within(cards[1]).getByTestId('product-merge-checkbox'))

    // 提交合并 → 弹 dialog
    const mergeBar = screen.getByTestId('product-merge-bar')
    await user.click(within(mergeBar).getByTestId('product-merge-submit'))

    const dialog = screen.getByTestId('product-merge-dialog')
    expect(dialog).toBeInTheDocument()
    const input = within(dialog).getByTestId('product-merge-title-input')
    await user.type(input, '合并后的标题')

    await user.click(within(dialog).getByTestId('product-merge-dialog-confirm'))

    expect(onAction).toHaveBeenCalledTimes(1)
    const arg = onAction.mock.calls[0][0]
    expect(arg.action).toBe('merge')
    expect(arg.kind).toBe('subproblems')
    expect(arg.ids.sort()).toEqual(['q1', 'q2'])
    expect(arg.newTitle).toBe('合并后的标题')
    expect(typeof arg.newId).toBe('string')
    expect(arg.newId.length).toBeGreaterThan(0)
  })

  it('合并 dialog:空 title → [确认] disabled', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    await user.click(within(cards[0]).getByTestId('product-card-merge-toggle'))
    await user.click(within(cards[0]).getByTestId('product-merge-checkbox'))
    await user.click(within(cards[1]).getByTestId('product-merge-checkbox'))
    await user.click(
      within(screen.getByTestId('product-merge-bar')).getByTestId(
        'product-merge-submit',
      ),
    )

    const dialog = screen.getByTestId('product-merge-dialog')
    const confirm = within(dialog).getByTestId('product-merge-dialog-confirm')
    expect(confirm).toBeDisabled()
  })

  it('合并 dialog:点 ✕ 取消 → 不调 onAction,dialog 关闭', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    await user.click(within(cards[0]).getByTestId('product-card-merge-toggle'))
    await user.click(within(cards[0]).getByTestId('product-merge-checkbox'))
    await user.click(within(cards[1]).getByTestId('product-merge-checkbox'))
    await user.click(
      within(screen.getByTestId('product-merge-bar')).getByTestId(
        'product-merge-submit',
      ),
    )

    const dialog = screen.getByTestId('product-merge-dialog')
    await user.click(within(dialog).getByTestId('product-merge-dialog-cancel'))

    expect(onAction).not.toHaveBeenCalled()
    expect(screen.queryByTestId('product-merge-dialog')).toBeNull()
  })

  it('合并模式:点 [取消] → 退出合并模式,所有卡片复选框消失', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    await user.click(within(cards[0]).getByTestId('product-card-merge-toggle'))
    expect(screen.getByTestId('product-merge-bar')).toBeInTheDocument()

    await user.click(within(screen.getByTestId('product-merge-bar')).getByTestId('product-merge-cancel'))

    expect(screen.queryByTestId('product-merge-bar')).toBeNull()
    expect(within(cards[0]).queryByTestId('product-merge-checkbox')).toBeNull()
  })
})

// ============================================================================
// 新增
// ============================================================================

describe('ProductList · 新增', () => {
  it('点 [+ 新增子问题] → 弹输入框(title 必填)', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    await user.click(screen.getByTestId('product-add-subproblems'))

    const dialog = screen.getByTestId('product-add-dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByTestId('product-add-title-input')).toBeInTheDocument()
    // [保存] 在 title 空时 disabled
    expect(within(dialog).getByTestId('product-add-dialog-confirm')).toBeDisabled()
  })

  it('新增 dialog:输入 title → [保存] enabled', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    await user.click(screen.getByTestId('product-add-subproblems'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), '新问题')

    expect(within(dialog).getByTestId('product-add-dialog-confirm')).not.toBeDisabled()
  })

  it('新增 dialog:点 [保存] → 调 onAction({action: add, kind, item:{id, title, severity}})', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    await user.click(screen.getByTestId('product-add-subproblems'))
    const dialog = screen.getByTestId('product-add-dialog')
    await user.type(within(dialog).getByTestId('product-add-title-input'), '新问题')

    await user.click(within(dialog).getByTestId('product-add-dialog-confirm'))

    expect(onAction).toHaveBeenCalledTimes(1)
    const arg = onAction.mock.calls[0][0]
    expect(arg.action).toBe('add')
    expect(arg.kind).toBe('subproblems')
    expect(arg.item.title).toBe('新问题')
    expect(typeof arg.item.id).toBe('string')
    expect(arg.item.id.length).toBeGreaterThan(0)
    // severity 有默认(blue)
    expect(arg.item.severity).toBe('blue')
  })

  it('新增 dialog:点 ✕ 取消 → 不调 onAction,dialog 关闭', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(<ProductList products={sampleGroup()} onAction={onAction} />)

    await user.click(screen.getByTestId('product-add-subproblems'))
    await user.click(within(screen.getByTestId('product-add-dialog')).getByTestId('product-add-dialog-cancel'))

    expect(onAction).not.toHaveBeenCalled()
    expect(screen.queryByTestId('product-add-dialog')).toBeNull()
  })
})

// ============================================================================
// 联动:对任意类型(📌 / ⚠️ / 🎨)都生效
// ============================================================================

describe('ProductList · 三类都对交互生效', () => {
  it('risks 类:卡片有点击触发器,+ 新增 按钮可用', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-risks')
    const card = within(section).getByTestId('product-risks-item')
    expect(within(card).getByTestId('product-card-edit')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-delete')).toBeInTheDocument()
    expect(within(card).getByTestId('product-card-merge-toggle')).toBeInTheDocument()

    await user.click(screen.getByTestId('product-add-risks'))
    expect(screen.getByTestId('product-add-dialog')).toBeInTheDocument()
  })

  it('options 类:点击 ✏️ 也能进编辑态', async () => {
    const user = userEvent.setup()
    render(<ProductList products={sampleGroup()} onAction={noopAsync} />)

    const section = screen.getByTestId('product-options')
    const card = within(section).getAllByTestId('product-options-item')[0]
    await user.click(within(card).getByTestId('product-card-edit'))

    expect(within(card).getByTestId('product-card-edit-input')).toBeInTheDocument()
  })
})

// ============================================================================
// 边界:错误处理 — onAction 抛错时不崩(graceful)
// ============================================================================

describe('ProductList · onAction 错误处理', () => {
  it('onAction 抛错 → 编辑态仍恢复(不阻塞 UI)', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockRejectedValue(new Error('server boom'))
    // suppress unhandled rejection from the test
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      render(<ProductList products={sampleGroup()} onAction={onAction} />)

      const section = screen.getByTestId('product-subproblems')
      const card = within(section).getAllByTestId('product-subproblems-item')[0]
      await user.click(within(card).getByTestId('product-card-edit'))
      const input = within(card).getByTestId('product-card-edit-input')
      await user.clear(input)
      await user.type(input, 'X')
      await user.click(within(card).getByTestId('product-card-save'))

      // 等 promise microtask flush(避免 jest 在 reject 时硬报)
      await new Promise((r) => setTimeout(r, 0))
      expect(onAction).toHaveBeenCalledTimes(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})