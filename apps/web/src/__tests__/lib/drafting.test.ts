import { describe, it, expect } from 'vitest'
import {
  shouldShowRepoSoftWarning,
  emptyDrafting,
  getDraftingData,
} from '@/lib/drafting'

// ============================================================================
// shouldShowRepoSoftWarning — 仓库软警告阈值(issue 08 验收 #4 #5 #6)
//
// 设计要点:返回 selectedRepoIds.length < 2 → true;
// 0 / 1 → true(警告显示);2 / 3 / N → false(警告隐藏)。
// 纯函数,O(1) 时间,无副作用;同一入参 → 同一结果。
// ============================================================================

describe('shouldShowRepoSoftWarning', () => {
  it('0 个仓库 → true(⚠ 仅 0 个仓库 · …)', () => {
    expect(shouldShowRepoSoftWarning([])).toBe(true)
  })

  it('1 个仓库 → true(⚠ 仅 1 个仓库 · …)', () => {
    expect(shouldShowRepoSoftWarning(['r1'])).toBe(true)
  })

  it('2 个仓库 → false(警告隐藏,边界值)', () => {
    expect(shouldShowRepoSoftWarning(['r1', 'r2'])).toBe(false)
  })

  it('3+ 仓库 → false(警告隐藏)', () => {
    expect(shouldShowRepoSoftWarning(['r1', 'r2', 'r3'])).toBe(false)
    expect(shouldShowRepoSoftWarning(['r1', 'r2', 'r3', 'r4', 'r5'])).toBe(false)
  })

  it('纯函数:相同入参 → 相同结果', () => {
    const a = shouldShowRepoSoftWarning(['x'])
    const b = shouldShowRepoSoftWarning(['x'])
    expect(a).toBe(b)
  })

  it('与顺序无关(只关心 length,不关心具体 id)', () => {
    expect(shouldShowRepoSoftWarning(['a', 'b'])).toBe(
      shouldShowRepoSoftWarning(['b', 'a']),
    )
  })

  it('接受 readonly 数组(由 selectedRepoIds 作为 React state 传入时不破坏可变性)', () => {
    const ro: readonly string[] = Object.freeze(['r1'])
    expect(shouldShowRepoSoftWarning(ro)).toBe(true)
  })
})

// ============================================================================
// emptyDrafting / getDraftingData · repos / selectedRepoIds 字段已就位
// ============================================================================

describe('DraftingData · repos / selectedRepoIds 字段', () => {
  it('emptyDrafting 返回空 repos / 空 selectedRepoIds(0 仓库触发软警告)', () => {
    const data = emptyDrafting('NEW')
    expect(data.repos).toEqual([])
    expect(data.selectedRepoIds).toEqual([])
    expect(shouldShowRepoSoftWarning(data.selectedRepoIds)).toBe(true)
  })

  it('getDraftingData(req-001) 返回样例数据带 5 个仓库 + 2 个已选中(软警告隐藏)', async () => {
    const data = await getDraftingData('req-001')
    // 5 个 chip:refund / order / coupon / payment / 更多…
    expect(data.repos.length).toBeGreaterThanOrEqual(4)
    // 默认勾选 refund + order → 软警告应隐藏(2 个 = 阈值边界)
    expect(data.selectedRepoIds.length).toBe(2)
    expect(shouldShowRepoSoftWarning(data.selectedRepoIds)).toBe(false)
  })
})