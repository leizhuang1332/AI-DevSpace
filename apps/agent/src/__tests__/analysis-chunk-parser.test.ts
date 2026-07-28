/**
 * SDK 文本 → 结构化 chunk 解析层单测(audit-2026-07-26 关键阻塞项 #2)
 *
 * 覆盖 `admission-check` / `requirement-brainstorm` 两个 built-in SKILL.md
 * 约定的输出标记:
 *   - `[DIM <id>]` + `verdict/severity/evidence/pending/quote`
 *   - `[VERDICT]`  + `result/pending_count/summary`
 *   - `[SUBPROBLEM]` / `[RISK]` / `[OPTION]` + `text` + `source_refs`
 *   - `[SUBPROBLEM_EMPTY]` 等空桶占位
 *   - 无标记自由文本 → narration 兜底(不丢内容)
 */

import { describe, it, expect } from 'vitest'
import { createAnalysisTextParser } from '../routes/analysis-chunk-parser.js'

/** 便捷:一次性喂完整文本 + flush,拿到全部 chunk */
function parseAll(text: string, fallbackLabel = 'INFER') {
  const p = createAnalysisTextParser({ fallbackLabel })
  return [...p.push(text), ...p.flush()]
}

describe('createAnalysisTextParser — [DIM] 块', () => {
  it('解析单个 DIM 块 → narration chunk + admission.dim/verdict', () => {
    const out = parseAll(
      [
        '[DIM loss_prevention]',
        'verdict: warn',
        'severity: 🔴',
        'evidence: 退款免审路径缺少风控校验。',
        'pending: 免审额度是否需风控',
        'quote: 退款单笔金额上限 ≤ 1000 元',
      ].join('\n'),
    )
    expect(out).toHaveLength(1)
    const c = out[0]
    expect(c.kind).toBe('narration')
    expect(c.admission).toEqual({ dim: 'loss_prevention', verdict: 'warn' })
    expect(c.tone).toBe('warn')
    expect(c.text).toContain('退款免审路径缺少风控校验。')
    expect(c.text).toContain('免审额度是否需风控')
    // narration 契约:不带 source_refs
    expect(c.source_refs).toBeUndefined()
  })

  it('DIM chunk 文本保留原始 `[DIM <id>]` 标记(audit 可追溯性)', () => {
    const out = parseAll(['[DIM loss_prevention]', 'verdict: pass', 'evidence: 无问题。'].join('\n'))
    expect(out[0].text).toContain('[DIM loss_prevention]')
    // 仍然有 UI 头部
    expect(out[0].text).toContain('资损安全')
  })

  it('[VERDICT] chunk 文本保留原始 `[VERDICT]` 标记(audit 可追溯性)', () => {
    const out = parseAll(['[VERDICT]', 'result: ✅', 'pending_count: 0', 'summary: 全部通过'].join('\n'))
    expect(out[0].text).toContain('[VERDICT]')
    expect(out[0].text).toContain('✅ 准入通过')
  })

  it('5 个 DIM 块 + [VERDICT] → 6 条 chunk,顺序保持', () => {
    const text = [
      '[DIM loss_prevention]',
      'verdict: pass',
      'evidence: 无资金流变更。',
      '',
      '[DIM performance]',
      'verdict: pass',
      'evidence: 无高频接口。',
      '',
      '[DIM arch_conflict]',
      'verdict: warn',
      'evidence: 与现有审核流冲突。',
      '',
      '[DIM business_reasonable]',
      'verdict: pass',
      'evidence: 目标清晰。',
      '',
      '[DIM context_query]',
      'verdict: warn',
      'evidence: 上限口径未定义。',
      '',
      '[VERDICT]',
      'result: ⚠️',
      'pending_count: 2',
      'summary: 两处待裁决。',
    ].join('\n')
    const out = parseAll(text)
    expect(out).toHaveLength(6)
    expect(out.map((c) => c.admission?.dim)).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
      undefined,
    ])
    expect(out[5].admission).toEqual({ overall: 'pending', pendingCount: 2 })
    expect(out[5].label).toBe('COMPLETE')
    expect(out[5].text).toContain('两处待裁决。')
  })

  it('verdict: fail → tone err;result: ❌ → overall fail', () => {
    const out = parseAll(
      ['[DIM loss_prevention]', 'verdict: fail', 'evidence: 直接资损。', '', '[VERDICT]', 'result: ❌', 'pending_count: 1'].join('\n'),
    )
    expect(out[0].tone).toBe('err')
    expect(out[1].admission?.overall).toBe('fail')
  })

  it('result: ✅ → overall pass', () => {
    const out = parseAll(['[VERDICT]', 'result: ✅', 'pending_count: 0', 'summary: 全部通过'].join('\n'))
    expect(out[0].admission).toEqual({ overall: 'pass', pendingCount: 0 })
    expect(out[0].tone).toBe('success')
  })

  it('非法 verdict 取值 → verdict 字段省略,仍产出 dim chunk', () => {
    const out = parseAll(['[DIM performance]', 'verdict: maybe', 'evidence: 无法判断。'].join('\n'))
    expect(out).toHaveLength(1)
    expect(out[0].admission).toEqual({ dim: 'performance' })
    expect(out[0].tone).toBe('info')
  })
})

describe('createAnalysisTextParser — 三桶块', () => {
  it('[SUBPROBLEM] + prd source_ref → kind subproblem + 结构化 source_refs', () => {
    const out = parseAll(
      [
        '[SUBPROBLEM]',
        'text: 单笔退款金额上限是否随用户等级差异化?',
        'source_refs:',
        '  - prd:8-12 "退款单笔金额上限 ≤ 1000 元"',
      ].join('\n'),
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('subproblem')
    expect(out[0].label).toBe('DETECT')
    expect(out[0].text).toBe('单笔退款金额上限是否随用户等级差异化?')
    expect(out[0].source_refs).toEqual([
      { kind: 'prd', lineRange: [8, 12], quote: '退款单笔金额上限 ≤ 1000 元' },
    ])
  })

  it('[RISK] → kind risk + tone warn;[OPTION] → kind option + tone success', () => {
    const out = parseAll(
      ['[RISK]', 'text: 并发退款可能重复入账。', '', '[OPTION]', 'text: 幂等网关 + 异步事件。'].join('\n'),
    )
    expect(out.map((c) => c.kind)).toEqual(['risk', 'option'])
    expect(out.map((c) => c.label)).toEqual(['RISK', 'OPTION'])
    expect(out.map((c) => c.tone)).toEqual(['warn', 'success'])
  })

  it('aux / asset source_ref 形态解析', () => {
    const out = parseAll(
      [
        '[RISK]',
        'text: 接口契约不一致。',
        'source_refs:',
        '  - aux:api-spec.md:12-18 "POST /refund"',
        '  - asset:prd-1',
      ].join('\n'),
    )
    expect(out[0].source_refs).toEqual([
      { kind: 'aux', auxId: 'api-spec.md', lineRange: [12, 18], quote: 'POST /refund' },
      { kind: 'asset', assetId: 'prd-1' },
    ])
  })

  it('非法 source_ref(倒置区间 / 缺 lineRange)被丢弃,不污染 chunk', () => {
    const out = parseAll(
      ['[OPTION]', 'text: 方案 A。', 'source_refs:', '  - prd:12-8 "倒置"', '  - prd:bad', '  - prd:1-2'].join('\n'),
    )
    expect(out[0].source_refs).toEqual([{ kind: 'prd', lineRange: [1, 2] }])
  })

  it('无 source_refs 的三桶 chunk → 不写 source_refs 字段', () => {
    const out = parseAll(['[SUBPROBLEM]', 'text: 没有出处的问题。'].join('\n'))
    expect(out[0].source_refs).toBeUndefined()
    expect('source_refs' in out[0]).toBe(false)
  })

  it('[SUBPROBLEM_EMPTY] → narration,不计入三桶', () => {
    const out = parseAll(['[SUBPROBLEM_EMPTY]', 'text: turn-1 已覆盖,无新增子问题。'].join('\n'))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('narration')
    expect(out[0].text).toContain('无新增子问题')
  })
})

describe('createAnalysisTextParser — 流式与兜底', () => {
  it('跨 push 的分片(标记被切成两半)仍能正确解析', () => {
    const p = createAnalysisTextParser({ fallbackLabel: 'INFER' })
    const out = [
      ...p.push('[SUBPRO'),
      ...p.push('BLEM]\ntext: 分片测'),
      ...p.push('试。\n'),
      ...p.flush(),
    ]
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('subproblem')
    expect(out[0].text).toBe('分片测试。')
  })

  it('逐字符喂入,结果与一次性喂入等价', () => {
    const text = '[RISK]\ntext: 逐字符。\nsource_refs:\n  - prd:1-3 "x"\n'
    const p = createAnalysisTextParser({ fallbackLabel: 'INFER' })
    const streamed = [...text].flatMap((ch) => p.push(ch)).concat(p.flush())
    expect(streamed).toEqual(parseAll(text))
  })

  it('无任何标记的自由文本 → narration 兜底(不丢内容)', () => {
    const out = parseAll('我先读一下 PRD 全文,再做五维度评估。')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('narration')
    expect(out[0].label).toBe('INFER')
    expect(out[0].text).toBe('我先读一下 PRD 全文,再做五维度评估。')
  })

  it('代码块围栏与 markdown 加粗包裹被容忍', () => {
    const out = parseAll(['```', '**[RISK]**', 'text: 被包裹的风险。', '```'].join('\n'))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('risk')
    expect(out[0].text).toBe('被包裹的风险。')
  })

  it('空文本 / 纯空白 → 不产出 chunk', () => {
    expect(parseAll('')).toEqual([])
    expect(parseAll('   \n\n  \n')).toEqual([])
  })

  it('三桶块缺 text: 字段 → 用块内剩余正文兜底', () => {
    const out = parseAll(['[SUBPROBLEM]', '退款上限口径未定义?'].join('\n'))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('subproblem')
    expect(out[0].text).toBe('退款上限口径未定义?')
  })

  it('text: 字段跨行续写被合并', () => {
    const out = parseAll(['[RISK]', 'text: 第一行,', '第二行。', 'source_refs:', '  - prd:0-1'].join('\n'))
    expect(out[0].text).toBe('第一行,\n第二行。')
  })
})
