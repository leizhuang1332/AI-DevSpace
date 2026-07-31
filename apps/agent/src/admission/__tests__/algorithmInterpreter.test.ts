/**
 * algorithmInterpreter 单测 —— ADR-0021 D8 (jq-simplified 表达式子集)
 *
 * 10 个语法元素 + 比较运算符 + else 分支:
 *   1. `.field` — 字段访问
 *   2. `'literal'` — 字符串字面量
 *   3. `==` / `!=` — 等值 / 不等值
 *   4. `<` / `>` / `<=` / `>=` — 数值比较(典型用法 `length >= 2`)
 *   5. `and` / `or` / `not` — 布尔逻辑
 *   6. `any(arr; pred)` — 存在量词
 *   7. `all(arr; pred)` — 全称量词
 *   8. `[arr | select(pred)]` — 数组过滤(取子集)
 *   9. `length` / `count` — 数组长度
 *   10. `true` / `false` — 布尔字面量
 *
 * 上下文:解释器在 verdict 计算层调用,输入是 UnitJudgment 列表,每条 judgment
 * 提供 `id / displayName / severity / verdict / evidence / pending / quote`,
 * algorithm 表达式在 `.field` 上访问 judgment 字段。
 *
 * 设计:本测试只测 `evaluateRule(expression, ctx)` 与 `runAlgorithm(algorithm, ctx)`
 * 的对外行为(命中 / 未命中 / else 命中);AST 形状 / parser 内部错误栈不在测试范围
 * (与 PRD §"Testing Decisions · 不写测试的边界"对齐)。
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateExpression,
  runAlgorithm,
  ExpressionSyntaxError,
} from '../algorithmInterpreter.js'
import type { AdmissionAlgorithm, UnitJudgment } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function j(opts: Partial<UnitJudgment>): UnitJudgment {
  return {
    id: 'x',
    displayName: 'X',
    severity: '🟢',
    verdict: 'pass',
    evidence: '',
    ...opts,
  }
}

/** 5 维度 baseline pack 上下文 —— 真实场景的 judgment 集 */
function baselineContext(): UnitJudgment[] {
  return [
    j({ id: 'loss_prevention', displayName: '资损安全', severity: '🔴', verdict: 'fail', evidence: '免审路径无风控' }),
    j({ id: 'performance', displayName: '性能', severity: '🟠', verdict: 'pass', evidence: '无高频接口' }),
    j({ id: 'arch_conflict', displayName: '架构冲突', severity: '🟡', verdict: 'warn', evidence: '与审核流冲突' }),
    j({ id: 'business_reasonable', displayName: '业务合理性', severity: '🟢', verdict: 'pass', evidence: '目标清晰' }),
    j({ id: 'context_query', displayName: '上下文确认', severity: '💬', verdict: 'warn', evidence: '上限口径未定义' }),
  ]
}

/** 拼一个简单的 algorithm —— baseline-loose 经典形态 */
function baselineAlgorithm(): AdmissionAlgorithm {
  return {
    id: 'baseline-loose',
    displayName: '默认宽松策略',
    rules: [
      {
        id: 'blocker_fail',
        when: 'any(units[]; .severity == "🔴" and .verdict == "fail")',
        result: '❌',
        reason: '存在红线级 fail',
      },
      {
        id: 'any_warn',
        when: 'any(units[]; .verdict == "warn")',
        result: '⚠️',
        reason: '存在 warn 维度',
      },
    ],
    else: {
      result: '✅',
      reason: '全部维度 pass',
    },
  }
}

// ---------------------------------------------------------------------------
// 语法元素 1-3:字段 / 字面量 / 等值比较
// ---------------------------------------------------------------------------

describe('evaluateExpression — 字段访问与字面量', () => {
  it('.field 访问 judgment 字段', () => {
    expect(evaluateExpression('.severity', { id: 'a', severity: '🔴', verdict: 'pass' })).toBe('🔴')
  })

  it('.verdict 访问单元 verdict', () => {
    expect(evaluateExpression('.verdict', { id: 'a', severity: '🟢', verdict: 'warn' })).toBe('warn')
  })

  it('字符串字面量(单引号)', () => {
    expect(evaluateExpression(`"fail"`, { id: 'a' })).toBe('fail')
    expect(evaluateExpression(`'fail'`, { id: 'a' })).toBe('fail')
  })

  it('数字字面量', () => {
    expect(evaluateExpression('42', {})).toBe(42)
    expect(evaluateExpression('3.14', {})).toBeCloseTo(3.14)
  })

  it('布尔字面量 true / false', () => {
    expect(evaluateExpression('true', {})).toBe(true)
    expect(evaluateExpression('false', {})).toBe(false)
  })

  it('未声明字段 → undefined', () => {
    expect(evaluateExpression('.missing', { id: 'a' })).toBeUndefined()
  })
})

describe('evaluateExpression — 等值 / 不等值', () => {
  it('.verdict == "warn"', () => {
    expect(evaluateExpression('.verdict == "warn"', { verdict: 'warn' })).toBe(true)
    expect(evaluateExpression('.verdict == "warn"', { verdict: 'pass' })).toBe(false)
  })

  it('.severity == "🔴" —— emoji 字符串比较', () => {
    expect(evaluateExpression('.severity == "🔴"', { severity: '🔴' })).toBe(true)
    expect(evaluateExpression('.severity == "🟢"', { severity: '🔴' })).toBe(false)
  })

  it('.verdict != "pass"', () => {
    expect(evaluateExpression('.verdict != "pass"', { verdict: 'warn' })).toBe(true)
    expect(evaluateExpression('.verdict != "pass"', { verdict: 'pass' })).toBe(false)
  })

  it('字符串与数字字面量比较', () => {
    expect(evaluateExpression('.id == "loss_prevention"', { id: 'loss_prevention' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 语法元素 4-5:数值比较 / 布尔逻辑
// ---------------------------------------------------------------------------

describe('evaluateExpression — 数值比较', () => {
  it('length 返数字字面量,可与 >= / < 比较', () => {
    const ctx: UnitJudgment[] = [
      j({ id: 'a', verdict: 'warn' }),
      j({ id: 'b', verdict: 'warn' }),
    ]
    // 直接对 evaluateExpression 喂上下文,length 在 ctx 自身上调
    expect(evaluateExpression('length >= 2', ctx)).toBe(true)
    expect(evaluateExpression('length < 5', ctx)).toBe(true)
    expect(evaluateExpression('length == 3', ctx)).toBe(false)
  })

  it('count(...) 等价 length', () => {
    const ctx: UnitJudgment[] = [j({ verdict: 'fail' }), j({ verdict: 'fail' }), j({ verdict: 'pass' })]
    expect(evaluateExpression('count == 3', ctx)).toBe(true)
  })

  it('单元字段数字比较(若有 numeric 字段)', () => {
    expect(evaluateExpression('.priority > 3', { priority: 5 })).toBe(true)
    expect(evaluateExpression('.priority <= 2', { priority: 5 })).toBe(false)
  })
})

describe('evaluateExpression — 布尔逻辑 and / or / not', () => {
  it('.v == "x" and .s == "y"', () => {
    expect(evaluateExpression('.v == "x" and .s == "y"', { v: 'x', s: 'y' })).toBe(true)
    expect(evaluateExpression('.v == "x" and .s == "z"', { v: 'x', s: 'y' })).toBe(false)
  })

  it('.v == "x" or .s == "z"', () => {
    expect(evaluateExpression('.v == "x" or .s == "z"', { v: 'x', s: 'y' })).toBe(true)
    expect(evaluateExpression('.v == "a" or .s == "z"', { v: 'x', s: 'y' })).toBe(false)
  })

  it('not(.v == "pass") —— 不等价的负向写法', () => {
    expect(evaluateExpression('not(.v == "pass")', { v: 'fail' })).toBe(true)
    expect(evaluateExpression('not(.v == "pass")', { v: 'pass' })).toBe(false)
  })

  it('and 优先级高于 or —— 标准布尔语义', () => {
    // (a or b) and c → 等价于表达式原意
    expect(
      evaluateExpression('.a == 1 or .b == 2 and .c == 3', { a: 0, b: 0, c: 3 }),
    ).toBe(false)
    expect(
      evaluateExpression('.a == 1 or .b == 2 and .c == 3', { a: 1, b: 0, c: 0 }),
    ).toBe(true)
  })

  it('括号显式分组', () => {
    expect(
      evaluateExpression('(.a == 1 or .b == 2) and .c == 3', { a: 1, b: 0, c: 3 }),
    ).toBe(true)
    expect(
      evaluateExpression('(.a == 1 or .b == 2) and .c == 3', { a: 1, b: 0, c: 0 }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 语法元素 6-7:any / all
// ---------------------------------------------------------------------------

describe('evaluateExpression — any / all(数组量词)', () => {
  const ctx = baselineContext()

  it('any(units[]; .severity == "🔴" and .verdict == "fail")', () => {
    expect(
      evaluateExpression(
        'any(units[]; .severity == "🔴" and .verdict == "fail")',
        ctx,
      ),
    ).toBe(true)
  })

  it('any(units[]; .verdict == "warn")', () => {
    expect(
      evaluateExpression('any(units[]; .verdict == "warn")', ctx),
    ).toBe(true)
  })

  it('all(units[]; .verdict != "fail") —— baseline 全通过', () => {
    // loss_prevention 是 fail,故 all 不成立
    expect(
      evaluateExpression('all(units[]; .verdict != "fail")', ctx),
    ).toBe(false)
  })

  it('all(units[]; .verdict == "pass" or .verdict == "warn") —— baseline 全部非 fail', () => {
    // loss_prevention 是 fail,既不是 pass 也不是 warn → all 不成立
    expect(
      evaluateExpression('all(units[]; .verdict == "pass" or .verdict == "warn")', ctx),
    ).toBe(false)
  })

  it('any(...) 对空数组 → false', () => {
    expect(evaluateExpression('any(units[]; .verdict == "fail")', [])).toBe(false)
  })

  it('all(...) 对空数组 → true(vacuous truth)', () => {
    expect(evaluateExpression('all(units[]; .verdict == "fail")', [])).toBe(true)
  })

  it('pred 内可用布尔组合', () => {
    expect(
      evaluateExpression(
        'any(units[]; .severity == "🔴" and .verdict == "fail")',
        ctx,
      ),
    ).toBe(true)
    expect(
      evaluateExpression(
        'any(units[]; .severity == "🟢" and .verdict == "fail")',
        ctx,
      ),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 语法元素 8:[A | select(pred)] 数组过滤
// ---------------------------------------------------------------------------

describe('evaluateExpression — [A | select(pred)]', () => {
  const ctx = baselineContext()

  it('[units[] | select(.verdict == "warn")] —— 取 warn 维度子集', () => {
    const out = evaluateExpression(
      '[units[] | select(.verdict == "warn")]',
      ctx,
    ) as UnitJudgment[]
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(2)
    expect(out.map((j) => j.id)).toEqual(['arch_conflict', 'context_query'])
  })

  it('select 不命中 → 空数组', () => {
    const out = evaluateExpression(
      '[units[] | select(.verdict == "impossible")]',
      ctx,
    ) as UnitJudgment[]
    expect(out).toEqual([])
  })

  it('select 可与 length 组合 —— "warn 维度 ≥ 2"', () => {
    const expr = '[units[] | select(.verdict == "warn")] | length >= 2'
    expect(evaluateExpression(expr, ctx)).toBe(true)
  })

  it('select 跨多字段复合条件', () => {
    const out = evaluateExpression(
      '[units[] | select(.severity == "🔴" and .verdict == "fail")]',
      ctx,
    ) as UnitJudgment[]
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('loss_prevention')
  })
})

// ---------------------------------------------------------------------------
// 语法元素 9:length / count
// ---------------------------------------------------------------------------

describe('evaluateExpression — length / count', () => {
  it('length 在数组上下文中返元素数', () => {
    expect(evaluateExpression('length', [j({}), j({}), j({})])).toBe(3)
    expect(evaluateExpression('length', [])).toBe(0)
  })

  it('count(...) 与 length 等价', () => {
    const ctx = [j({}), j({})] as UnitJudgment[]
    expect(evaluateExpression('count', ctx)).toBe(2)
  })

  it('length 与 select 链式调用', () => {
    const ctx = baselineContext()
    expect(
      evaluateExpression('[units[] | select(.verdict == "pass")] | length', ctx),
    ).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 语法元素 10:布尔字面量(已覆盖)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// runAlgorithm —— 规则 + else
// ---------------------------------------------------------------------------

describe('runAlgorithm —— 规则匹配与 else 兜底', () => {
  it('第一条规则命中 → 返该规则的 verdict + reason + ruleId', () => {
    const alg = baselineAlgorithm()
    const out = runAlgorithm(alg, baselineContext())
    expect(out.verdict).toBe('❌')
    expect(out.hitRuleId).toBe('blocker_fail')
    expect(out.reason).toContain('红线')
  })

  it('第一条未命中但第二条命中 → 返第二条的 verdict + reason', () => {
    const alg = baselineAlgorithm()
    // 把 loss_prevention 改成 pass → blocker_fail 不命中,但仍有 warn
    const ctx = baselineContext().map((u) =>
      u.id === 'loss_prevention' ? { ...u, verdict: 'pass' as const } : u,
    )
    const out = runAlgorithm(alg, ctx)
    expect(out.verdict).toBe('⚠️')
    expect(out.hitRuleId).toBe('any_warn')
  })

  it('所有规则未命中 → 走 else 分支', () => {
    const alg = baselineAlgorithm()
    const allPass = baselineContext().map((u) => ({ ...u, verdict: 'pass' as const }))
    const out = runAlgorithm(alg, allPass)
    expect(out.verdict).toBe('✅')
    expect(out.reason).toContain('全部')
    expect(out.hitRuleId).toBeUndefined()
  })

  it('空上下文 → 走 else(任意规则都不命中)', () => {
    const alg = baselineAlgorithm()
    const out = runAlgorithm(alg, [])
    expect(out.verdict).toBe('✅')
    expect(out.hitRuleId).toBeUndefined()
  })

  it('返回结果带 computedAt (ISO 8601)', () => {
    const alg = baselineAlgorithm()
    const out = runAlgorithm(alg, baselineContext())
    expect(typeof out.computedAt).toBe('string')
    expect(out.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('返回结果带 packId', () => {
    const alg: AdmissionAlgorithm = { ...baselineAlgorithm(), id: 'baseline-loose' }
    const out = runAlgorithm(alg, baselineContext(), 'my-pack-1')
    expect(out.packId).toBe('my-pack-1')
  })

  it('金融严格算法:warn ≥ 2 直接判 ❌', () => {
    const alg: AdmissionAlgorithm = {
      id: 'finance-strict',
      displayName: '金融严格',
      rules: [
        // 注意:多 warn 优先级高于 🔴 fail(刻意测试更严的策略形态)
        {
          id: 'multi_warn',
          when: '[units[] | select(.verdict == "warn")] | length >= 2',
          result: '❌',
          reason: 'warn 维度过多(≥ 2)',
        },
        {
          id: 'blocker_fail',
          when: 'any(units[]; .severity == "🔴" and .verdict == "fail")',
          result: '❌',
          reason: '红线 fail',
        },
        {
          id: 'any_warn',
          when: 'any(units[]; .verdict == "warn")',
          result: '⚠️',
          reason: '存在 warn',
        },
      ],
      else: {
        result: '✅',
        reason: '全部 pass',
      },
    }
    // baseline context 有 2 个 warn → multi_warn 命中(优先级最高)
    const out = runAlgorithm(alg, baselineContext())
    expect(out.verdict).toBe('❌')
    expect(out.hitRuleId).toBe('multi_warn')
  })
})

// ---------------------------------------------------------------------------
// 表达式 syntax 错误 → ExpressionSyntaxError
// ---------------------------------------------------------------------------

describe('evaluateExpression / runAlgorithm — syntax 错误', () => {
  it('未声明的语法 → ExpressionSyntaxError', () => {
    expect(() => evaluateExpression('wat(?)', [])).toThrow(ExpressionSyntaxError)
  })

  it('裸标识符(非 .field / 关键字 / 字面量)→ ExpressionSyntaxError', () => {
    expect(() => evaluateExpression('foo', [])).toThrow(ExpressionSyntaxError)
  })

  it('括号不闭合 → ExpressionSyntaxError', () => {
    expect(() => evaluateExpression('(.v == "x"', { v: 'x' })).toThrow(ExpressionSyntaxError)
  })

  it('字符串字面量未闭合 → ExpressionSyntaxError', () => {
    expect(() => evaluateExpression('.v == "unterminated', { v: 'x' })).toThrow(ExpressionSyntaxError)
  })

  it('runAlgorithm:某条规则 syntax 错 → 抛 ExpressionSyntaxError(让 validator 接管降级)', () => {
    const alg: AdmissionAlgorithm = {
      id: 'broken',
      displayName: '坏算法',
      rules: [
        { id: 'bad', when: 'unclosed(', result: '❌', reason: 'bad' },
      ],
      else: { result: '✅', reason: 'ok' },
    }
    expect(() => runAlgorithm(alg, baselineContext())).toThrow(ExpressionSyntaxError)
  })

  it('ExpressionSyntaxError 携带行/列与片段(可定位错误表达式)', () => {
    try {
      evaluateExpression('unclosed(', [])
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionSyntaxError)
      const err = e as ExpressionSyntaxError
      expect(err.snippet).toBe('unclosed(')
    }
  })
})