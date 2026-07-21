/**
 * analyzing-source-refs.test.ts —— ticket 01 验收
 *
 * ADR-0017 D3 / D6 · JSONL 兼容性 + SourceRef 类型守卫
 *
 * 覆盖:
 * 1. `isSourceRef` 三种子类型(prd / aux / asset)的有效路径
 * 2. `isSourceRef` 拒绝无效输入(false / 缺失字段 / 错类型)
 * 3. `AnalyzingChunk` 含 / 不含 `source_refs` 的 JSONL 读写
 * 4. `deriveProducts()` 透传 `source_refs` 到 `AnalyzingProductItem`
 * 5. `deriveProducts()` 透传 `synthetic: true` 标记
 * 6. JSONL 历史兼容:写入无 `source_refs` / `synthetic` 的 chunk → 读回字段是 undefined
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isSourceRef,
  serializeAnalyzingChunk,
  deriveProducts,
  countCitationsByDoc,
  collectCitationRefs,
  buildCitationSpans,
  countAssetCitations,
  type AnalyzingChunk,
  type SourceRef,
  type PrdSourceRef,
  type AuxSourceRef,
  type AssetSourceRef,
} from '@/lib/analyzing'
import { loadSessionChunks } from '@/lib/analyzing.server'

// ============================================================================
// isSourceRef — 类型守卫
// ============================================================================

describe('isSourceRef · 三种子类型', () => {
  it('kind: "prd" + 合法 lineRange → true', () => {
    expect(isSourceRef({ kind: 'prd', lineRange: [10, 20] })).toBe(true)
    expect(isSourceRef({ kind: 'prd', lineRange: [0, 0] })).toBe(true)
  })

  it('kind: "prd" + 0-based 半开边界:[0, 1) 仅 1 行 ✓', () => {
    expect(isSourceRef({ kind: 'prd', lineRange: [0, 1] })).toBe(true)
  })

  it('kind: "prd" + quote 可选 string → true', () => {
    expect(
      isSourceRef({ kind: 'prd', lineRange: [5, 10], quote: '退款单笔金额上限 ≤ 1000 元' }),
    ).toBe(true)
  })

  it('kind: "prd" + quote 为空字符串 / 纯空白 → 仍 true(ADR D3 不约束 quote 形态)', () => {
    // ADR-0017 D3:`quote?: string` 未规定非空;上层根据需要自决使用
    expect(isSourceRef({ kind: 'prd', lineRange: [5, 10], quote: '' })).toBe(true)
    expect(isSourceRef({ kind: 'prd', lineRange: [5, 10], quote: '   ' })).toBe(true)
  })

  it('kind: "prd" + quote 非 string → false', () => {
    expect(isSourceRef({ kind: 'prd', lineRange: [5, 10], quote: 123 })).toBe(false)
    expect(isSourceRef({ kind: 'prd', lineRange: [5, 10], quote: null })).toBe(false)
  })

  it('kind: "aux" + 合法 auxId + lineRange → true', () => {
    expect(
      isSourceRef({ kind: 'aux', auxId: 'aux-api-refund', lineRange: [0, 5] }),
    ).toBe(true)
  })

  it('kind: "aux" + auxId 缺失 / 非 string / 空字符串 → false', () => {
    expect(isSourceRef({ kind: 'aux', lineRange: [0, 5] })).toBe(false)
    expect(isSourceRef({ kind: 'aux', auxId: 123, lineRange: [0, 5] })).toBe(false)
    // 空字符串:downstream 用作 AuxFile.id 查找,空串会破坏匹配 → 拒绝
    expect(isSourceRef({ kind: 'aux', auxId: '', lineRange: [0, 5] })).toBe(false)
  })

  it('kind: "aux" + auxId 缺失但 lineRange 合法 → false(aux 必填 auxId)', () => {
    expect(
      isSourceRef({ kind: 'aux', lineRange: [0, 5], quote: 'foo' }),
    ).toBe(false)
  })

  it('kind: "asset" + 合法 assetId → true', () => {
    expect(isSourceRef({ kind: 'asset', assetId: 'prd-1.png' })).toBe(true)
  })

  it('kind: "asset" 不需要 lineRange(资产无行概念)', () => {
    expect(isSourceRef({ kind: 'asset', assetId: 'prd-1.png' })).toBe(true)
    // 即使附带无关字段也接受(forward-compat)
    expect(
      isSourceRef({ kind: 'asset', assetId: 'prd-1.png', extra: 'ignored' }),
    ).toBe(true)
  })

  it('kind: "asset" + assetId 缺失或非 string → false', () => {
    expect(isSourceRef({ kind: 'asset' })).toBe(false)
    expect(isSourceRef({ kind: 'asset', assetId: 123 })).toBe(false)
    expect(isSourceRef({ kind: 'asset', assetId: '' })).toBe(false)
  })
})

describe('isSourceRef · 拒绝无效输入', () => {
  it('null → false', () => {
    expect(isSourceRef(null)).toBe(false)
  })

  it('undefined → false', () => {
    expect(isSourceRef(undefined)).toBe(false)
  })

  it('非对象(数字/字符串/布尔)→ false', () => {
    expect(isSourceRef(42)).toBe(false)
    expect(isSourceRef('hello')).toBe(false)
    expect(isSourceRef(true)).toBe(false)
  })

  it('缺 kind → false', () => {
    expect(isSourceRef({ lineRange: [0, 1] })).toBe(false)
  })

  it('kind 是未知字符串 → false', () => {
    expect(isSourceRef({ kind: 'unknown', lineRange: [0, 1] })).toBe(false)
    expect(isSourceRef({ kind: 'chunk', id: 'foo' })).toBe(false)
  })

  it('lineRange 缺位 → false', () => {
    expect(isSourceRef({ kind: 'prd' })).toBe(false)
    expect(isSourceRef({ kind: 'prd', lineRange: [0] })).toBe(false)
  })

  it('lineRange 含非数字 → false', () => {
    expect(isSourceRef({ kind: 'prd', lineRange: ['a', 'b'] })).toBe(false)
    expect(isSourceRef({ kind: 'prd', lineRange: [0, '1'] })).toBe(false)
  })

  it('lineRange 含 Infinity / NaN → false', () => {
    expect(isSourceRef({ kind: 'prd', lineRange: [0, Infinity] })).toBe(false)
    expect(isSourceRef({ kind: 'prd', lineRange: [NaN, 1] })).toBe(false)
    // 倒置区间(起点 > 终点)→ false(防御性,半开区间无效)
    expect(isSourceRef({ kind: 'prd', lineRange: [10, 5] })).toBe(false)
  })

  it('lineRange 长度 ≠ 2 → false', () => {
    expect(isSourceRef({ kind: 'prd', lineRange: [0, 1, 2] })).toBe(false)
    expect(isSourceRef({ kind: 'prd', lineRange: [] })).toBe(false)
  })

  it('不可信输入不抛错', () => {
    // 不应抛 TypeError —— 用 try-catch 显式保证
    expect(() => isSourceRef({ kind: 'prd', lineRange: null })).not.toThrow()
    expect(isSourceRef({ kind: 'prd', lineRange: null })).toBe(false)
  })
})

// ============================================================================
// SourceRef brand sub-types(ADR-0017 D3 · ticket 01 验收 "3 个 brand 子类型")
// ============================================================================
//
// 三种子类型:`PrdSourceRef` / `AuxSourceRef` / `AssetSourceRef`。
// 它们因各自带 `unique symbol` brand 字段,在 **TS 类型层**不可互换:
//   prd.value 不可被当作 aux.value 使用 / 反之。
// vitest 跑在 runtime 上无法验证 TS 类型隔离(那靠 `tsc --noEmit`),
// 本节只能验证:
//   1) 三种子类型可以字面量构造(类型层编译通过即代表声明有效)
//   2) discriminated union `SourceRef = Prd | Aux | Asset` 经 isSourceRef 窄化
//      后能按 kind 取出对应字面量

describe('SourceRef brand sub-types(类型签名)', () => {
  it('PrdSourceRef / AuxSourceRef / AssetSourceRef 可以独立字面量构造', () => {
    const prd: PrdSourceRef = {
      kind: 'prd',
      lineRange: [10, 20],
      quote: '原文',
    }
    const aux: AuxSourceRef = {
      kind: 'aux',
      auxId: 'aux-api',
      lineRange: [0, 5],
    }
    const asset: AssetSourceRef = {
      kind: 'asset',
      assetId: 'prd-1.png',
    }
    expect(prd.kind).toBe('prd')
    expect(aux.kind).toBe('aux')
    expect(asset.kind).toBe('asset')
    // discriminated union 类型对齐
    const refs: SourceRef[] = [prd, aux, asset]
    expect(refs.map((r) => r.kind)).toEqual(['prd', 'aux', 'asset'])
  })

  it('SourceRef 经 isSourceRef 窄化后按 kind 取对应字段', () => {
    const raw: unknown[] = [
      { kind: 'prd', lineRange: [0, 1] },
      { kind: 'aux', auxId: 'a', lineRange: [2, 4] },
      { kind: 'asset', assetId: 'x.png' },
    ]
    for (const obj of raw) {
      if (!isSourceRef(obj)) continue
      // narrow on kind 取对应字段:
      if (obj.kind === 'prd') {
        expect(Array.isArray(obj.lineRange)).toBe(true)
      } else if (obj.kind === 'aux') {
        expect(obj.auxId).toBe('a')
      } else if (obj.kind === 'asset') {
        expect(obj.assetId).toBe('x.png')
      } else {
        throw new Error('unreachable')
      }
    }
  })
})

// ============================================================================
// serializeAnalyzingChunk —— SSE / JSONL 序列化层
// ============================================================================

describe('serializeAnalyzingChunk', () => {
  it('基础字段(id/ts/label/text/kind/tone)始终输出', () => {
    const chunk: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'START',
      kind: 'narration',
      tone: 'info',
      text: '开始',
    }
    const out = serializeAnalyzingChunk(chunk)
    expect(out.id).toBe('c-1')
    expect(out.ts).toBe('14:23:01')
    expect(out.label).toBe('START')
    expect(out.kind).toBe('narration')
    expect(out.tone).toBe('info')
    expect(out.text).toBe('开始')
  })

  it('subproblem 含 source_refs → 显式写出数组(JSONL 体积优化要求)', () => {
    const refs: SourceRef[] = [
      { kind: 'prd', lineRange: [10, 20] },
      { kind: 'asset', assetId: 'x.png' },
    ]
    const chunk: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'success',
      text: 'Q1',
      source_refs: refs,
    }
    const out = serializeAnalyzingChunk(chunk)
    expect(out.source_refs).toBe(refs) // 引用相等(pure pass-through)
  })

  it('subproblem + source_refs: 空数组 → 显式保留 [] (≠ 字段缺省)', () => {
    const chunk: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: 'no refs',
      source_refs: [],
    }
    const out = serializeAnalyzingChunk(chunk)
    // `[]` 显式写,即使空。区分"AI 说没引用"vs"AI 没写字段"
    expect('source_refs' in out).toBe(true)
    expect(out.source_refs).toEqual([])
  })

  it('subproblem 不带 source_refs → 字段完全省略(无键)', () => {
    const chunk: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: 'no field',
    }
    const out = serializeAnalyzingChunk(chunk)
    expect('source_refs' in out).toBe(false)
  })

  it('narration chunk + source_refs → 序列化时强制不带(契约二次保障)', () => {
    const chunk: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'START',
      kind: 'narration',
      tone: 'info',
      text: '开始',
      source_refs: [{ kind: 'prd', lineRange: [0, 1] }],
    }
    const out = serializeAnalyzingChunk(chunk)
    expect('source_refs' in out).toBe(false) // narration 一律不带
  })

  it('synthetic: true → 显式写出', () => {
    const chunk: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: '用户加',
      synthetic: true,
    }
    const out = serializeAnalyzingChunk(chunk)
    expect(out.synthetic).toBe(true)
  })

  it('synthetic: false(显式 false)→ 也写出;缺失时省略(语义不同)', () => {
    const withFalse: AnalyzingChunk = {
      id: 'c-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: '显式 false',
      synthetic: false,
    }
    const outFalse = serializeAnalyzingChunk(withFalse)
    expect('synthetic' in outFalse).toBe(true)
    expect(outFalse.synthetic).toBe(false)

    const withoutField: AnalyzingChunk = {
      id: 'c-2',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: '缺省',
    }
    const outNone = serializeAnalyzingChunk(withoutField)
    expect('synthetic' in outNone).toBe(false)
  })
})

// ============================================================================
// JSONL 读写(loadSessionChunks + isSourceRef 集成)—— ADR-0017 D3
// ============================================================================

describe('loadSessionChunks · JSONL source_refs 兼容(ADR-0017 D3)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'analyzing-source-refs-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('写入含 source_refs 的 chunk → 读回 source_refs 完整', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    const refs: SourceRef[] = [
      { kind: 'prd', lineRange: [10, 20], quote: '退款单笔金额上限 ≤ 1000 元' },
      { kind: 'aux', auxId: 'aux-api-refund', lineRange: [0, 5] },
      { kind: 'asset', assetId: 'refund-flow.png' },
    ]
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      JSON.stringify({
        id: 'c-1',
        ts: '14:23:01',
        label: 'DETECT',
        kind: 'subproblem',
        tone: 'success',
        text: 'Q1',
        source_refs: refs,
      }),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].source_refs).toEqual(refs)
    expect(chunks[0].source_refs).toHaveLength(3)
  })

  it('写入历史 chunk(无 source_refs)→ 读回 source_refs 为 undefined,不报错', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      JSON.stringify({
        id: 'c-1',
        ts: '14:23:01',
        label: 'RISK',
        kind: 'risk',
        tone: 'warn',
        text: '高并发退款',
      }),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].source_refs).toBeUndefined()
  })

  it('source_refs 含无效项 → 仅过滤无效项,保留有效项', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      JSON.stringify({
        id: 'c-1',
        ts: '14:23:01',
        label: 'RISK',
        kind: 'risk',
        tone: 'warn',
        text: 'mixed refs',
        source_refs: [
          { kind: 'prd', lineRange: [10, 20] }, // ✓ 有效
          { kind: 'prd', lineRange: [0] }, // ✗ 长度不足
          { kind: 'aux', auxId: 'aux-a', lineRange: [0, 5] }, // ✓ 有效
          { kind: 'prd' }, // ✗ 缺 lineRange
          { kind: 'asset', assetId: 'prd-1.png' }, // ✓ 有效
          null, // ✗ 非对象
          { kind: 'unknown' }, // ✗ 未知 kind
        ],
      }),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].source_refs).toHaveLength(3)
    expect(chunks[0].source_refs?.[0]).toEqual({ kind: 'prd', lineRange: [10, 20] })
    expect(chunks[0].source_refs?.[1]).toEqual({
      kind: 'aux',
      auxId: 'aux-a',
      lineRange: [0, 5],
    })
    expect(chunks[0].source_refs?.[2]).toEqual({
      kind: 'asset',
      assetId: 'prd-1.png',
    })
  })

  it('source_refs 是空数组 → 字段保留 [] 以表达"AI 明确不引用源"(ADR D3)', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      JSON.stringify({
        id: 'c-1',
        ts: '14:23:01',
        label: 'RISK',
        kind: 'risk',
        tone: 'warn',
        text: 'no refs',
        source_refs: [],
      }),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks).toHaveLength(1)
    // ADR D3 明确:`[]` ≠ 省略字段;要保留以区分 "AI 说没引用" vs "AI 没写"
    expect(chunks[0].source_refs).toEqual([])
  })

  it('synthetic: true → 读回时透传为 boolean', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      JSON.stringify({
        id: 'c-1',
        ts: '14:23:01',
        label: 'DETECT',
        kind: 'subproblem',
        tone: 'info',
        text: '用户添加',
        synthetic: true,
      }),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].synthetic).toBe(true)
  })

  it('synthetic 字段非 boolean(数字/字符串)→ 忽略(容错)', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      [
        JSON.stringify({
          id: 'c-1',
          ts: '14:23:01',
          label: 'DETECT',
          kind: 'subproblem',
          tone: 'info',
          text: 'a',
          synthetic: 1,
        }),
        JSON.stringify({
          id: 'c-2',
          ts: '14:23:02',
          label: 'DETECT',
          kind: 'subproblem',
          tone: 'info',
          text: 'b',
          synthetic: 'true',
        }),
        JSON.stringify({
          id: 'c-3',
          ts: '14:23:03',
          label: 'DETECT',
          kind: 'subproblem',
          tone: 'info',
          text: 'c',
          synthetic: false,
        }),
      ].join('\n'),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3'])
    expect(chunks[0].synthetic).toBeUndefined() // 数字 → 忽略
    expect(chunks[1].synthetic).toBeUndefined() // 字符串 → 忽略
    expect(chunks[2].synthetic).toBe(false) // 合法 boolean
  })

  it('narration chunk 在 JSONL 里写了 source_refs → loader 强制丢弃(契约二次保障)', () => {
    const sessionDir = join(tmpDir, 'sess-x')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      JSON.stringify({
        id: 'c-1',
        ts: '14:23:01',
        label: 'START',
        kind: 'narration',
        tone: 'info',
        text: '开始',
        source_refs: [
          { kind: 'prd', lineRange: [0, 1] },
          { kind: 'aux', auxId: 'a', lineRange: [2, 4] },
        ],
      }),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-x')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].kind).toBe('narration')
    // narration chunk 一律不带 source_refs(契约二次保障)
    expect(chunks[0].source_refs).toBeUndefined()
  })
})

// ============================================================================
// deriveProducts — 透传 source_refs / synthetic(ADR-0017 D3 + D6)
// ============================================================================

describe('deriveProducts · 透传 source_refs', () => {
  it('chunk 含 source_refs → product 含 source_refs(引用相等)', () => {
    const refs: SourceRef[] = [
      { kind: 'prd', lineRange: [10, 20] },
      { kind: 'asset', assetId: 'prd-1.png' },
    ]
    const chunk: AnalyzingChunk = {
      id: 'q-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: '退款金额上限?',
      source_refs: refs,
    }
    const g = deriveProducts([chunk])
    expect(g.subproblems).toHaveLength(1)
    expect(g.subproblems[0].source_refs).toBe(refs) // 引用相等 —— pure pass-through
    expect(g.subproblems[0].source_refs).toHaveLength(2)
  })

  it('chunk 无 source_refs → product.source_refs 是 undefined', () => {
    const chunk: AnalyzingChunk = {
      id: 'q-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: 'no refs',
    }
    const g = deriveProducts([chunk])
    expect(g.subproblems[0].source_refs).toBeUndefined()
    // 字段不应存在于 product 对象上(undefined 显式省略)
    expect('source_refs' in g.subproblems[0]).toBe(false)
  })

  it('narration chunk 不进入 product 桶(与既有行为一致)', () => {
    const chunk: AnalyzingChunk = {
      id: 'n-1',
      ts: '14:23:01',
      label: 'START',
      kind: 'narration',
      tone: 'info',
      text: '开始',
      source_refs: [{ kind: 'prd', lineRange: [0, 1] }],
    }
    const g = deriveProducts([chunk])
    expect(g.subproblems).toHaveLength(0)
    expect(g.risks).toHaveLength(0)
    expect(g.options).toHaveLength(0)
  })

  it('kind: risk / option 同样透传 source_refs', () => {
    const refs: SourceRef[] = [{ kind: 'aux', auxId: 'aux-api', lineRange: [5, 10] }]
    const chunks: AnalyzingChunk[] = [
      {
        id: 'r-1',
        ts: '14:23:01',
        label: 'RISK',
        kind: 'risk',
        tone: 'warn',
        text: '并发重复',
        source_refs: refs,
      },
      {
        id: 'o-1',
        ts: '14:23:01',
        label: 'OPTION',
        kind: 'option',
        tone: 'success',
        text: 'A · 同步',
        source_refs: refs,
      },
    ]
    const g = deriveProducts(chunks)
    expect(g.risks[0].source_refs).toBe(refs)
    expect(g.options[0].source_refs).toBe(refs)
  })
})

describe('deriveProducts · 透传 synthetic(ADR-0017 D6 · ticket 04 落地占位)', () => {
  it('chunk.synthetic: true → product.synthetic: true', () => {
    const chunk: AnalyzingChunk = {
      id: 'user-added-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: '用户添加的子问题',
      synthetic: true,
    }
    const g = deriveProducts([chunk])
    expect(g.subproblems[0].synthetic).toBe(true)
  })

  it('chunk 无 synthetic → product.synthetic 是 undefined(字段省略)', () => {
    const chunk: AnalyzingChunk = {
      id: 'q-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: 'AI 识别',
    }
    const g = deriveProducts([chunk])
    expect(g.subproblems[0].synthetic).toBeUndefined()
    expect('synthetic' in g.subproblems[0]).toBe(false)
  })

  it('chunk.synthetic: false(显式 false)→ product.synthetic: false 透传', () => {
    const chunk: AnalyzingChunk = {
      id: 'q-1',
      ts: '14:23:01',
      label: 'DETECT',
      kind: 'subproblem',
      tone: 'info',
      text: '显式 false',
      synthetic: false,
    }
    const g = deriveProducts([chunk])
    expect(g.subproblems[0].synthetic).toBe(false)
  })

  it('synthetic + source_refs 共存 → 两个字段都透传', () => {
    const refs: SourceRef[] = [{ kind: 'prd', lineRange: [0, 5] }]
    const chunk: AnalyzingChunk = {
      id: 'u-1',
      ts: '14:23:01',
      label: 'RISK',
      kind: 'risk',
      tone: 'info',
      text: '用户加的风险',
      source_refs: refs,
      synthetic: true,
    }
    const g = deriveProducts([chunk])
    expect(g.risks[0].source_refs).toBe(refs)
    expect(g.risks[0].synthetic).toBe(true)
  })
})

// ============================================================================
// countCitationsByDoc — 引用计数派生(ADR-0017 D2 · ticket 03 验收)
// ============================================================================

describe('countCitationsByDoc · 引用计数分桶', () => {
  it('空数组 → 全 0(aux 为空对象)', () => {
    expect(countCitationsByDoc([])).toEqual({ prd: 0, aux: {}, asset: 0 })
  })

  it('全 narration(无 source_refs)→ 全 0', () => {
    const chunks: AnalyzingChunk[] = [
      { id: 'n-1', ts: 't', label: 'START', kind: 'narration', tone: 'info', text: '开始' },
      { id: 'n-2', ts: 't', label: 'READ', kind: 'narration', tone: 'info', text: '读' },
    ]
    expect(countCitationsByDoc(chunks)).toEqual({ prd: 0, aux: {}, asset: 0 })
  })

  it('单一 prd source_ref → prd=1', () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: 't',
        label: 'DETECT',
        kind: 'subproblem',
        tone: 'info',
        text: 'Q1',
        source_refs: [{ kind: 'prd', lineRange: [0, 3] }],
      },
    ]
    expect(countCitationsByDoc(chunks)).toEqual({ prd: 1, aux: {}, asset: 0 })
  })

  it('混合多 source_refs → 正确分桶(prd / aux 按 auxId / asset)', () => {
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: 't',
        label: 'DETECT',
        kind: 'subproblem',
        tone: 'info',
        text: 'Q1',
        source_refs: [
          { kind: 'prd', lineRange: [0, 3] },
          { kind: 'aux', auxId: 'aux-api', lineRange: [1, 2] },
          { kind: 'asset', assetId: 'flow.png' },
        ],
      },
      {
        id: 'r-1',
        ts: 't',
        label: 'RISK',
        kind: 'risk',
        tone: 'warn',
        text: 'R1',
        source_refs: [
          { kind: 'prd', lineRange: [4, 6] },
          { kind: 'aux', auxId: 'aux-api', lineRange: [3, 4] },
          { kind: 'aux', auxId: 'aux-data', lineRange: [0, 1] },
        ],
      },
      // 空数组 chunk 不计
      { id: 'o-1', ts: 't', label: 'OPTION', kind: 'option', tone: 'success', text: 'A', source_refs: [] },
    ]
    expect(countCitationsByDoc(chunks)).toEqual({
      prd: 2,
      aux: { 'aux-api': 2, 'aux-data': 1 },
      asset: 1,
    })
  })
})

// ============================================================================
// collectCitationRefs — 按文档分桶收集原始 ref(ADR-0017 D4)
// ============================================================================

describe('collectCitationRefs · 分桶原始 ref', () => {
  it('空 → 空桶', () => {
    expect(collectCitationRefs([])).toEqual({ prd: [], aux: {}, asset: [] })
  })

  it('按 kind / auxId 分桶,保留原始对象', () => {
    const prdRef: PrdSourceRef = { kind: 'prd', lineRange: [0, 3], quote: 'x' }
    const auxRef: AuxSourceRef = { kind: 'aux', auxId: 'aux-api', lineRange: [1, 2] }
    const assetRef: AssetSourceRef = { kind: 'asset', assetId: 'flow.png' }
    const chunks: AnalyzingChunk[] = [
      {
        id: 'q-1',
        ts: 't',
        label: 'DETECT',
        kind: 'subproblem',
        tone: 'info',
        text: 'Q1',
        source_refs: [prdRef, auxRef, assetRef],
      },
    ]
    const grouped = collectCitationRefs(chunks)
    expect(grouped.prd[0]).toBe(prdRef)
    expect(grouped.aux['aux-api'][0]).toBe(auxRef)
    expect(grouped.asset[0]).toBe(assetRef)
  })
})

// ============================================================================
// buildCitationSpans — 去重 span + 越界跳过 + quote mismatch
// ============================================================================

describe('buildCitationSpans · 去重 / 越界 / quote', () => {
  const doc = ['line0', 'line1', 'line2', 'line3', 'line4'].join('\n') // 5 行

  it('空文档 → []', () => {
    expect(buildCitationSpans('', [{ lineRange: [0, 1] }])).toEqual([])
  })

  it('空 refs → []', () => {
    expect(buildCitationSpans(doc, [])).toEqual([])
  })

  it('同一 lineRange 被 3 个产物引用 → 一条 span,refsCount=3', () => {
    const spans = buildCitationSpans(doc, [
      { lineRange: [1, 2] },
      { lineRange: [1, 2] },
      { lineRange: [1, 2] },
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({ lineRange: [1, 2], refsCount: 3, quoteMismatch: false })
  })

  it('不同 lineRange → 多条 span,按 start 升序', () => {
    const spans = buildCitationSpans(doc, [
      { lineRange: [3, 4] },
      { lineRange: [0, 1] },
    ])
    expect(spans.map((s) => s.lineRange[0])).toEqual([0, 3])
  })

  it('lineRange 越界(start >= 行数)→ 该 ref 跳过', () => {
    const spans = buildCitationSpans(doc, [
      { lineRange: [0, 1] }, // ✓
      { lineRange: [5, 6] }, // ✗ start=5 >= 5 行
      { lineRange: [99, 100] }, // ✗
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0].lineRange).toEqual([0, 1])
  })

  it('start < 0 → 跳过', () => {
    expect(buildCitationSpans(doc, [{ lineRange: [-1, 1] }])).toEqual([])
  })

  it('quote 与 lineRange 文本一致 → quoteMismatch=false', () => {
    const spans = buildCitationSpans(doc, [{ lineRange: [1, 2], quote: 'line1' }])
    expect(spans[0].quoteMismatch).toBe(false)
  })

  it('quote 与 lineRange 文本不一致 → quoteMismatch=true(仍按 lineRange 高亮)', () => {
    const spans = buildCitationSpans(doc, [{ lineRange: [1, 2], quote: '不存在的原文' }])
    expect(spans).toHaveLength(1)
    expect(spans[0].lineRange).toEqual([1, 2])
    expect(spans[0].quoteMismatch).toBe(true)
  })

  it('空 / 纯空白 quote → 不触发 mismatch', () => {
    expect(buildCitationSpans(doc, [{ lineRange: [1, 2], quote: '' }])[0].quoteMismatch).toBe(false)
    expect(buildCitationSpans(doc, [{ lineRange: [1, 2], quote: '   ' }])[0].quoteMismatch).toBe(false)
  })

  it('end 越界但 start 合法 → 保留(end 渲染时 clamp)', () => {
    const spans = buildCitationSpans(doc, [{ lineRange: [4, 99] }])
    expect(spans).toHaveLength(1)
    expect(spans[0].lineRange).toEqual([4, 99])
  })
})

// ============================================================================
// countAssetCitations — 每张图被引用次数
// ============================================================================

describe('countAssetCitations · 图片引用计数', () => {
  it('空 → {}', () => {
    expect(countAssetCitations([])).toEqual({})
  })

  it('按 assetId 分桶累加', () => {
    const refs: AssetSourceRef[] = [
      { kind: 'asset', assetId: 'a.png' },
      { kind: 'asset', assetId: 'a.png' },
      { kind: 'asset', assetId: 'b.png' },
    ]
    expect(countAssetCitations(refs)).toEqual({ 'a.png': 2, 'b.png': 1 })
  })
})
