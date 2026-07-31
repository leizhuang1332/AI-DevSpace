/**
 * algorithmValidator —— ADR-0021 D14 V-3 语义降级
 *
 * 在 schema(zod)校验通过后,做语义层校验:
 *   1. 规则 id 唯一性 → 重复 → error
 *   2. 每条规则的 `when` 表达式 syntax → 错 → error
 *
 * 不做(由 loader 负责):
 *   - YAML parse / 缺字段(结构 fail-fast)—— 在 packLoader
 *   - unit / algorithm 跨包冲突(语义警告,聚合到 loader 层)
 *
 * 返回:
 *   - { ok: true, algorithm } —— 校验通过,直接用
 *   - { ok: false, error } —— 校验失败;error.code 指示失败类别
 *
 * Loader 根据 error.code 决定:
 *   - 结构错(此处不出现)→ fail-fast 抛错
 *   - 语义错 → log warning + 跳过该规则 + 仍组装 pack
 */

import type { AdmissionAlgorithm } from '@ai-devspace/shared'
import { evaluateExpression, ExpressionSyntaxError } from './algorithmInterpreter.js'

export type AlgorithmValidationErrorCode = 'rule_id_collision' | 'rule_syntax_error'

export class AlgorithmValidationError extends Error {
  public readonly code: AlgorithmValidationErrorCode
  public readonly detail: string
  /** 出错的规则 id(若适用)—— 给 loader 用来填 AdmissionPackWarning.target */
  public readonly ruleId: string | undefined
  constructor(
    code: AlgorithmValidationErrorCode,
    detail: string,
    opts?: { ruleId?: string },
  ) {
    super(`algorithm validation failed [${code}]: ${detail}`)
    this.name = 'AlgorithmValidationError'
    this.code = code
    this.detail = detail
    this.ruleId = opts?.ruleId
  }
}

export type AlgorithmValidationResult =
  | { ok: true; algorithm: AdmissionAlgorithm }
  | { ok: false; error: AlgorithmValidationError }

/** 校验算法 —— 不修改输入,失败时返回错误细节 */
export function validateAlgorithm(algorithm: AdmissionAlgorithm): AlgorithmValidationResult {
  // 1. 规则 id 唯一性
  const seenIds = new Set<string>()
  for (const rule of algorithm.rules) {
    if (seenIds.has(rule.id)) {
      return {
        ok: false,
        error: new AlgorithmValidationError(
          'rule_id_collision',
          `duplicate rule id '${rule.id}'`,
          { ruleId: rule.id },
        ),
      }
    }
    seenIds.add(rule.id)
  }

  // 2. 每条规则 when 表达式 syntax
  for (const rule of algorithm.rules) {
    try {
      // 喂一个空数组占位(ctx 不影响 syntax 检查 —— parse-only 阶段)
      evaluateExpression(rule.when, [])
    } catch (err) {
      if (err instanceof ExpressionSyntaxError) {
        return {
          ok: false,
          error: new AlgorithmValidationError(
            'rule_syntax_error',
            `rule '${rule.id}': ${err.message}`,
            { ruleId: rule.id },
          ),
        }
      }
      throw err
    }
  }

  return { ok: true, algorithm }
}