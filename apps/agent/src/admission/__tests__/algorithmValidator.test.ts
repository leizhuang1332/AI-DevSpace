/**
 * algorithmValidator 单测 —— ADR-0021 D14 V-3 语义降级
 *
 * Validator 职责:在 schema 校验(已通过 zod)之后,做"语义层"校验。
 *
 * 校验对象 = AdmissionAlgorithm(已 schema 校验通过)
 * 语义错误 = 规则 id 重复 / `when` 表达式 syntax 错
 *
 * 返回: { ok: true, algorithm } 或 { ok: false, error }。
 * 注意:validator 不"修"算法,只产出错误。Loader 拿这个结果决定 fail-fast 还是降级。
 */

import { describe, it, expect } from 'vitest'
import {
  validateAlgorithm,
  AlgorithmValidationError,
} from '../algorithmValidator.js'
import type { AdmissionAlgorithm } from '@ai-devspace/shared'

function rule(id: string, when: string): AdmissionAlgorithm['rules'][number] {
  return { id, when, result: '❌', reason: id }
}

describe('validateAlgorithm — 合法算法', () => {
  it('baseline-loose 形态算法 → ok', () => {
    const alg: AdmissionAlgorithm = {
      id: 'baseline-loose',
      displayName: '默认宽松策略',
      rules: [
        rule('blocker_fail', 'any(units[]; .severity == "🔴" and .verdict == "fail")'),
        rule('any_warn', 'any(units[]; .verdict == "warn")'),
      ],
      else: { result: '✅', reason: '全部维度 pass' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.algorithm.id).toBe('baseline-loose')
    }
  })

  it('空规则列表 + else 兜底 → ok', () => {
    const alg: AdmissionAlgorithm = {
      id: 'pass-through',
      displayName: '直通',
      rules: [],
      else: { result: '✅', reason: '默认通过' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(true)
  })
})

describe('validateAlgorithm — 规则 id 重复', () => {
  it('两条规则同 id → ok=false,error 标注重复', () => {
    const alg: AdmissionAlgorithm = {
      id: 'dup',
      displayName: '重复 id',
      rules: [rule('a', 'true'), rule('a', 'false')],
      else: { result: '✅', reason: 'ok' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toBeInstanceOf(AlgorithmValidationError)
      expect(out.error.code).toBe('rule_id_collision')
      expect(out.error.detail).toContain('a')
    }
  })

  it('三规则两两同 id → 报告一个 collision(首个重复对)', () => {
    const alg: AdmissionAlgorithm = {
      id: 'dup',
      displayName: '重复 id',
      rules: [rule('a', 'true'), rule('a', 'true'), rule('b', 'true')],
      else: { result: '✅', reason: 'ok' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(false)
  })
})

describe('validateAlgorithm — 表达式 syntax 错', () => {
  it('unclosed paren → ok=false,syntax_error 标注规则 id', () => {
    const alg: AdmissionAlgorithm = {
      id: 'broken',
      displayName: '坏算法',
      rules: [rule('bad', 'unclosed(')],
      else: { result: '✅', reason: 'ok' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.code).toBe('rule_syntax_error')
      expect(out.error.detail).toContain('bad')
    }
  })

  it('某规则 ok 另一规则 syntax 错 → 报告错的那条', () => {
    const alg: AdmissionAlgorithm = {
      id: 'mixed',
      displayName: '混合',
      rules: [
        rule('good', 'any(units[]; .verdict == "fail")'),
        rule('broken', 'wat(?)'),
      ],
      else: { result: '✅', reason: 'ok' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.code).toBe('rule_syntax_error')
      expect(out.error.detail).toContain('broken')
    }
  })
})

describe('validateAlgorithm — else 分支引用', () => {
  it('else 分支无表达式,无需 syntax 校验 → ok', () => {
    const alg: AdmissionAlgorithm = {
      id: 'with-else',
      displayName: '带 else',
      rules: [rule('a', 'true')],
      else: { result: '⚠️', reason: '兜底警告' },
    }
    const out = validateAlgorithm(alg)
    expect(out.ok).toBe(true)
  })
})