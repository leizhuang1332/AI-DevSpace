import { describe, it, expect } from 'vitest'
import {
  shouldShowRepoSoftWarning,
  emptyDrafting,
  getDraftingData,
} from '@/lib/drafting'

// ============================================================================
// shouldShowRepoSoftWarning — 仓库软警告阈值(issue 08 验收 #4 #5 #6 · 字段跟改 issue 06)
//
// 设计要点:返回 selectedRepoNames.length < 2 → true;
// 0 / 1 → true(警告显示);2 / 3 / N → false(警告隐藏)。
// 纯函数,O(1) 时间,无副作用;同一入参 → 同一结果。
// ============================================================================

describe('shouldShowRepoSoftWarning', () => {
  it('0 个仓库 → true(⚠ 仅 0 个仓库 · …)', () => {
    expect(shouldShowRepoSoftWarning([])).toBe(true)
  })

  it('1 个仓库 → true(⚠ 仅 1 个仓库 · …)', () => {
    expect(shouldShowRepoSoftWarning(['refund-service'])).toBe(true)
  })

  it('2 个仓库 → false(警告隐藏,边界值)', () => {
    expect(shouldShowRepoSoftWarning(['refund-service', 'order-service'])).toBe(false)
  })

  it('3+ 仓库 → false(警告隐藏)', () => {
    expect(shouldShowRepoSoftWarning(['a', 'b', 'c'])).toBe(false)
    expect(shouldShowRepoSoftWarning(['a', 'b', 'c', 'd', 'e'])).toBe(false)
  })

  it('纯函数:相同入参 → 相同结果', () => {
    const a = shouldShowRepoSoftWarning(['refund-service'])
    const b = shouldShowRepoSoftWarning(['refund-service'])
    expect(a).toBe(b)
  })

  it('与顺序无关(只关心 length,不关心具体 name)', () => {
    expect(shouldShowRepoSoftWarning(['a', 'b'])).toBe(
      shouldShowRepoSoftWarning(['b', 'a']),
    )
  })

  it('接受 readonly 数组(由 selectedRepoNames 作为 React state 传入时不破坏可变性)', () => {
    const ro: readonly string[] = Object.freeze(['refund-service'])
    expect(shouldShowRepoSoftWarning(ro)).toBe(true)
  })
})

// ============================================================================
// emptyDrafting / getDraftingData · repos / selectedRepoNames 字段已就位(issue 06)
//
// issue 06 (ADR-0030) 跟改:
// - repos 字段由 SSR `getDraftingDataFromFs` 从 `<root>/repos.yaml` 派生后注入;
//   `emptyDrafting` 起点是 [],mock `getDraftingData('req-001')` 含 4 个示例仓库
// - `selectedRepoNames` 直接对应仓库 name(无 `repo-` 前缀)
// ============================================================================

describe('DraftingData · repos / selectedRepoNames 字段(issue 06)', () => {
  it('emptyDrafting 返回空 repos(SSR 注入前;issue 06 删除 GLOBAL_REPO_POOL mock)', () => {
    // issue 06 (ADR-0030):空草稿不再注入写死 mock 仓库池 —— repos = [] 由 SSR 覆盖。
    // selectedRepoNames 仍为空,触发软警告 + banner 显示
    const data = emptyDrafting('NEW')
    expect(data.repos).toEqual([])
    expect(data.selectedRepoNames).toEqual([])
    expect(shouldShowRepoSoftWarning(data.selectedRepoNames)).toBe(true)
  })

  it('getDraftingData(req-001) 返回样例数据带 4 个仓库(name/gitUrl/description)+ 2 个已选中(软警告隐藏)', async () => {
    const data = await getDraftingData('req-001')
    // 4 个示例仓库(issue 06 跟改后,REFUND_DRAFTING 的 5 个列表里去掉占位 ＋更多仓库…)
    expect(data.repos.length).toBeGreaterThanOrEqual(4)
    expect(data.repos[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        gitUrl: expect.any(String),
        description: expect.any(String),
      }),
    )
    // 默认勾选 refund-service + order-service → 软警告应隐藏(2 个 = 阈值边界)
    expect(data.selectedRepoNames).toEqual(['refund-service', 'order-service'])
    expect(shouldShowRepoSoftWarning(data.selectedRepoNames)).toBe(false)
  })
})