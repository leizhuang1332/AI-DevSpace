/**
 * analyzing-synthetic-chunk.test.ts —— ticket 04 验收(ADR-0017 D6)
 *
 * 覆盖 `buildSyntheticChunk()` 纯函数:
 * 1. 三种 kind(subproblems / risks / options)输出正确 label / kind 映射
 * 2. id 前缀 `user-added-` + 唯一性
 * 3. `synthetic: true` 必带 / `tone: 'info'`
 * 4. `source_refs` 省略 vs 传入两种情况
 * 5. 经 `deriveProducts()` 派生 product 透传 id / title / source_refs / synthetic
 */

import { describe, it, expect } from 'vitest'
import {
  buildSyntheticChunk,
  deriveProducts,
  type SourceRef,
} from '@/lib/analyzing'

// ============================================================================
// kind → label / chunk.kind 映射
// ============================================================================

describe('buildSyntheticChunk · kind 映射', () => {
  it('subproblems → label DETECT / kind subproblem', () => {
    const c = buildSyntheticChunk({ kind: 'subproblems', title: 'Q · 新问题', ts: '14:30:00' })
    expect(c.label).toBe('DETECT')
    expect(c.kind).toBe('subproblem')
  })

  it('risks → label RISK / kind risk', () => {
    const c = buildSyntheticChunk({ kind: 'risks', title: '新风险', ts: '14:30:00' })
    expect(c.label).toBe('RISK')
    expect(c.kind).toBe('risk')
  })

  it('options → label OPTION / kind option', () => {
    const c = buildSyntheticChunk({ kind: 'options', title: 'C · 新方案', ts: '14:30:00' })
    expect(c.label).toBe('OPTION')
    expect(c.kind).toBe('option')
  })
})

// ============================================================================
// 固定字段:text / ts / tone / synthetic
// ============================================================================

describe('buildSyntheticChunk · 固定字段', () => {
  it('text = params.title;ts 透传;tone 恒为 info', () => {
    const c = buildSyntheticChunk({ kind: 'subproblems', title: '标题内容', ts: '2026-07-22T14:30:00.000Z' })
    expect(c.text).toBe('标题内容')
    expect(c.ts).toBe('2026-07-22T14:30:00.000Z')
    expect(c.tone).toBe('info')
  })

  it('synthetic: true 必带', () => {
    const c = buildSyntheticChunk({ kind: 'risks', title: 'x', ts: 't' })
    expect(c.synthetic).toBe(true)
  })
})

// ============================================================================
// id:前缀 + 唯一性
// ============================================================================

describe('buildSyntheticChunk · id', () => {
  it('id 前缀为 user-added-', () => {
    const c = buildSyntheticChunk({ kind: 'options', title: 'x', ts: 't' })
    expect(c.id.startsWith('user-added-')).toBe(true)
    expect(c.id.length).toBeGreaterThan('user-added-'.length)
  })

  it('多次调用生成的 id 互相唯一', () => {
    const ids = Array.from({ length: 50 }, () =>
      buildSyntheticChunk({ kind: 'subproblems', title: 'x', ts: 't' }).id,
    )
    const set = new Set(ids)
    // 断言 id 唯一性(备注:product id 冲突防护)
    expect(set.size).toBe(ids.length)
  })
})

// ============================================================================
// source_refs:省略 vs 传入
// ============================================================================

describe('buildSyntheticChunk · source_refs', () => {
  it('未传 sourceRefs → 字段完全省略(无键)', () => {
    const c = buildSyntheticChunk({ kind: 'subproblems', title: 'no refs', ts: 't' })
    expect('source_refs' in c).toBe(false)
    expect(c.source_refs).toBeUndefined()
  })

  it('传入 sourceRefs → 透传(引用相等)', () => {
    const refs: SourceRef[] = [
      { kind: 'prd', lineRange: [10, 20] },
      { kind: 'aux', auxId: 'aux-api', lineRange: [0, 5] },
    ]
    const c = buildSyntheticChunk({ kind: 'risks', title: 'with refs', ts: 't', sourceRefs: refs })
    expect(c.source_refs).toBe(refs)
    expect(c.source_refs).toHaveLength(2)
  })

  it('传入空数组 → 字段保留 [](区分 "用户不选" 与 "字段缺省")', () => {
    const c = buildSyntheticChunk({ kind: 'options', title: 'empty refs', ts: 't', sourceRefs: [] })
    expect('source_refs' in c).toBe(true)
    expect(c.source_refs).toEqual([])
  })
})

// ============================================================================
// 派生 product:透传 id / title / source_refs / synthetic
// ============================================================================

describe('buildSyntheticChunk → deriveProducts 派生 product', () => {
  it('subproblems synthetic chunk → product 落在 subproblems 桶且 synthetic:true', () => {
    const c = buildSyntheticChunk({ kind: 'subproblems', title: '用户加的子问题', ts: 't' })
    const g = deriveProducts([c])
    expect(g.subproblems).toHaveLength(1)
    expect(g.subproblems[0].id).toBe(c.id)
    expect(g.subproblems[0].title).toBe('用户加的子问题')
    expect(g.subproblems[0].synthetic).toBe(true)
    // 无 source_refs → product 也不带该字段
    expect('source_refs' in g.subproblems[0]).toBe(false)
  })

  it('带 source_refs 的 synthetic chunk → product 透传 source_refs + synthetic', () => {
    const refs: SourceRef[] = [{ kind: 'prd', lineRange: [0, 3] }]
    const c = buildSyntheticChunk({ kind: 'risks', title: '有出处的风险', ts: 't', sourceRefs: refs })
    const g = deriveProducts([c])
    expect(g.risks[0].source_refs).toBe(refs)
    expect(g.risks[0].synthetic).toBe(true)
  })
})
