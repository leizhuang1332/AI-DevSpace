import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { ProductList } from '@/components/product-list'
import type { AnalyzingProductGroup } from '@/lib/analyzing'

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// 辅助:空组 / 满组 / 自定义组
// ---------------------------------------------------------------------------

function emptyGroup(): AnalyzingProductGroup {
  return { subproblems: [], risks: [], options: [] }
}

function sampleGroup(): AnalyzingProductGroup {
  return {
    subproblems: [
      { id: 'q1', title: 'Q1 · 退款金额上限?', severity: 'green' },
      { id: 'q2', title: 'Q2 · 退款审核流?', description: '自动 / 人工 / 阈值', severity: 'green' },
    ],
    risks: [
      { id: 'r1', title: '高并发退款重复创建', severity: 'orange' },
    ],
    options: [
      { id: 'o1', title: 'A · 同步单阶段', description: '单事务 · 250ms', severity: 'green' },
      { id: 'o2', title: 'B · 异步多阶段', severity: 'green' },
    ],
  }
}

// ============================================================================
// 渲染 — 三类分区
// ============================================================================

describe('ProductList · 渲染', () => {
  it('根节点 + 3 个分区(subproblems / risks / options)渲染', () => {
    render(<ProductList products={sampleGroup()} />)
    expect(screen.getByTestId('product-list')).toBeInTheDocument()
    expect(screen.getByTestId('product-subproblems')).toBeInTheDocument()
    expect(screen.getByTestId('product-risks')).toBeInTheDocument()
    expect(screen.getByTestId('product-options')).toBeInTheDocument()
  })

  it('三类分区标题含 emoji + 中文 label', () => {
    render(<ProductList products={sampleGroup()} />)
    expect(screen.getByTestId('product-subproblems').textContent).toContain('📌')
    expect(screen.getByTestId('product-subproblems').textContent).toContain('子问题')
    expect(screen.getByTestId('product-risks').textContent).toContain('⚠️')
    expect(screen.getByTestId('product-risks').textContent).toContain('风险点')
    expect(screen.getByTestId('product-options').textContent).toContain('🎨')
    expect(screen.getByTestId('product-options').textContent).toContain('方案方向')
  })

  it('标题区元信息显示 "2 子问题 + 1 风险 + 2 方案" 计数', () => {
    render(<ProductList products={sampleGroup()} />)
    // ProductList 头部 .font-mono.text-xs.text-text-3 内的计数文案
    const headerMeta = screen
      .getByTestId('product-list')
      .querySelector('.font-mono.text-xs.text-text-3')
    expect(headerMeta?.textContent).toContain('2')
    expect(headerMeta?.textContent).toContain('1')
    expect(headerMeta?.textContent).toContain('子问题')
    expect(headerMeta?.textContent).toContain('风险')
    expect(headerMeta?.textContent).toContain('方案')
  })
})

// ============================================================================
// 单类分区内的列表与卡片
// ============================================================================

describe('ProductList · 卡片渲染', () => {
  it('子问题分区有 2 张卡片(只读,无编辑/删除按钮)', () => {
    render(<ProductList products={sampleGroup()} />)
    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    expect(cards).toHaveLength(2)
    expect(cards[0].getAttribute('data-item-id')).toBe('q1')
    expect(cards[0].getAttribute('data-severity')).toBe('green')
  })

  it('卡片 title 显示完整,有 description 时附加在 title 之下', () => {
    render(<ProductList products={sampleGroup()} />)
    const section = screen.getByTestId('product-subproblems')
    const cards = within(section).getAllByTestId('product-subproblems-item')
    expect(cards[0].textContent).toContain('Q1 · 退款金额上限?')
    expect(cards[0].textContent).not.toContain('自动') // q1 没 description
    expect(cards[1].textContent).toContain('Q2 · 退款审核流?')
    expect(cards[1].textContent).toContain('自动 / 人工 / 阈值') // q2 有 description
  })

  it('severity 决定卡片左侧 border-l 类(orange → border-l-warning)', () => {
    render(<ProductList products={sampleGroup()} />)
    const section = screen.getByTestId('product-risks')
    const card = within(section).getByTestId('product-risks-item')
    expect(card.className).toContain('border-l-warning')
    expect(card.className).toContain('border-l-[3px]')
  })
})

// ============================================================================
// 空态文案
// ============================================================================

describe('ProductList · 空态', () => {
  it('三类均为空时,每个分区显示"暂无 X"占位文案', () => {
    render(<ProductList products={emptyGroup()} />)
    expect(screen.getByTestId('product-subproblems-empty').textContent).toBe('暂无子问题')
    expect(screen.getByTestId('product-risks-empty').textContent).toBe('暂无风险')
    expect(screen.getByTestId('product-options-empty').textContent).toBe('暂无方案')
    // 任何分区都不应有 item card
    expect(screen.queryByTestId('product-subproblems-item')).toBeNull()
    expect(screen.queryByTestId('product-risks-item')).toBeNull()
    expect(screen.queryByTestId('product-options-item')).toBeNull()
  })

  it('只有一类为空时,该分区显示空态,其他分区正常渲染', () => {
    const partial: AnalyzingProductGroup = {
      subproblems: [{ id: 'q1', title: 'Q1', severity: 'green' }],
      risks: [],
      options: [{ id: 'o1', title: 'A', severity: 'green' }],
    }
    render(<ProductList products={partial} />)
    expect(screen.queryByTestId('product-subproblems-empty')).toBeNull()
    expect(screen.getByTestId('product-risks-empty').textContent).toBe('暂无风险')
    expect(screen.queryByTestId('product-options-empty')).toBeNull()
  })
})

// ============================================================================
// 只读约束(issue 19d 才会加 inline edit / delete / merge / new,本 slice 不允许)
// ============================================================================

describe('ProductList · 只读约束', () => {
  it('editable=false 时,卡片无 ✏️ / 🗑 / 合并 / + 编辑按钮(显式只读模式)', () => {
    // VS4 起 ProductList 默认 editable=true;此处显式传 false 验证"只读回退路径"
    render(<ProductList products={sampleGroup()} editable={false} />)
    // 整张列表不应出现"编辑"/"删除"/"合并"/"新增"等按钮文案
    const root = screen.getByTestId('product-list')
    expect(root.textContent).not.toContain('编辑')
    expect(root.textContent).not.toContain('删除')
    expect(root.textContent).not.toContain('合并')
    // 也没有"+"按钮(新增)
    expect(root.querySelector('button')).toBeNull()
  })
})
