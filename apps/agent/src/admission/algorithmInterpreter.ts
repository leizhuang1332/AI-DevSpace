/**
 * algorithmInterpreter —— ADR-0021 D8 (jq-simplified 表达式子集)
 *
 * 表达式子集(10 个语法元素):
 *   1. `.field`            — 字段访问(.verdict / .severity / ...)
 *   2. `'<string>'`        — 单引号字符串字面量
 *   3. `"<string>"`        — 双引号字符串字面量
 *   4. `<number>`          — 数字字面量(int / float)
 *   5. `true` / `false`    — 布尔字面量
 *   6. `==` / `!=`         — 等值 / 不等值
 *   7. `<` / `>` / `<=` / `>=` — 数值比较(支持 length >= 2 这种)
 *   8. `and` / `or` / `not` — 布尔逻辑(and 优先级 > or;可用括号)
 *   9. `any(arr; pred)`    — 存在量词
 *   10. `all(arr; pred)`   — 全称量词
 *   11. `[A | select(pred)]` — 数组过滤
 *   12. `length` / `count` — 数组长度(隐式作用于 ctx)
 *
 * 语法定位:
 *   - **不是** 完整 jq(ADR-0021 D8 明确限定子集)
 *   - **不是** JSONLogic(冗长)
 *   - **不是** Python(沙箱重)
 *   - 自写递归下降 parser,纯 TS
 *
 * 表达式上下文(`evaluateExpression(expr, ctx)`):
 *   - `ctx` 通常是 `UnitJudgment[]`;`units[]` 在量词/select 中隐式指向 ctx。
 *   - 单条 judgment 也合法 —— `.field` 可直接访问 judgment 字段。
 *
 * 沙箱安全:
 *   - parser 不引入 eval / Function / VM
 *   - 所有"调用"是预定义的语法形式(any / all / length / count / select)
 *   - 表达式作者无法触达 Node globals / filesystem / network
 */

import type {
  AdmissionAlgorithm,
  PackVerdict,
  UnitJudgment,
  Verdict,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** 表达式 syntax 错 —— validator / loader 在语义降级时识别 */
export class ExpressionSyntaxError extends Error {
  public readonly snippet: string
  constructor(expression: string, message: string) {
    super(`Expression syntax error in \`${expression}\`: ${message}`)
    this.name = 'ExpressionSyntaxError'
    this.snippet = expression
  }
}

// ---------------------------------------------------------------------------
// AST(内不暴露 —— 测试契约是 evaluateExpression 的入参/出参形态)
// ---------------------------------------------------------------------------

type Expr =
  | { kind: 'field'; name: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'iter' } // `units[]` —— 当前 judgment 数组
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'logical'; op: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'pipe'; left: Expr; right: Expr } // 顶层 `|` —— 把左侧结果作为右侧 ctx
  | { kind: 'unary'; op: 'not'; operand: Expr }
  | { kind: 'any'; arr: Expr; pred: Expr }
  | { kind: 'all'; arr: Expr; pred: Expr }
  | { kind: 'select'; arr: Expr; pred: Expr }
  | { kind: 'length'; operand: Expr }
  | { kind: 'paren'; inner: Expr }

type BinaryOp = '==' | '!=' | '<' | '>' | '<=' | '>='

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind =
  | 'dot'
  | 'ident'
  | 'string'
  | 'number'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'semicolon'
  | 'pipe'
  | 'op' // == != < > <= >=
  | 'keyword' // and or not any all select length count true false

interface Token {
  kind: TokenKind
  value: string
  pos: number
}

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'any',
  'all',
  'select',
  'length',
  'count',
  'true',
  'false',
])

const MULTI_CHAR_OPS = ['==', '!=', '<=', '>=']

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // 多字符优先
    if (ch === '=' || ch === '!' || ch === '<' || ch === '>') {
      const two = src.slice(i, i + 2)
      if (MULTI_CHAR_OPS.includes(two)) {
        out.push({ kind: 'op', value: two, pos: i })
        i += 2
        continue
      }
      if (ch === '=' || ch === '!') {
        throw new ExpressionSyntaxError(src, `unexpected '${ch}' at position ${i}`)
      }
      out.push({ kind: 'op', value: ch, pos: i })
      i++
      continue
    }
    if (ch === '.') {
      out.push({ kind: 'dot', value: '.', pos: i })
      i++
      continue
    }
    if (ch === '(') {
      out.push({ kind: 'lparen', value: '(', pos: i })
      i++
      continue
    }
    if (ch === ')') {
      out.push({ kind: 'rparen', value: ')', pos: i })
      i++
      continue
    }
    if (ch === '[') {
      out.push({ kind: 'lbracket', value: '[', pos: i })
      i++
      continue
    }
    if (ch === ']') {
      out.push({ kind: 'rbracket', value: ']', pos: i })
      i++
      continue
    }
    if (ch === ';') {
      out.push({ kind: 'semicolon', value: ';', pos: i })
      i++
      continue
    }
    if (ch === '|') {
      out.push({ kind: 'pipe', value: '|', pos: i })
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      const start = i
      i++
      let s = ''
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1]
          if (next === quote || next === '\\') {
            s += next
            i += 2
            continue
          }
        }
        s += src[i]!
        i++
      }
      if (i >= src.length) {
        throw new ExpressionSyntaxError(src, `unterminated string at position ${start}`)
      }
      i++ // 跳过闭合 quote
      out.push({ kind: 'string', value: s, pos: start })
      continue
    }
    if (/[0-9]/.test(ch)) {
      const start = i
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++
      const text = src.slice(start, i)
      const n = Number(text)
      if (Number.isNaN(n)) {
        throw new ExpressionSyntaxError(src, `invalid number '${text}' at position ${start}`)
      }
      out.push({ kind: 'number', value: String(n), pos: start })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i]!)) i++
      const text = src.slice(start, i)
      if (KEYWORDS.has(text)) {
        out.push({ kind: 'keyword', value: text, pos: start })
      } else {
        out.push({ kind: 'ident', value: text, pos: start })
      }
      continue
    }
    throw new ExpressionSyntaxError(src, `unexpected character '${ch}' at position ${i}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Parser(recursive descent)
//
// 优先级(从低到高):
//   pipe_expr → or_expr ('|' or_expr)*         ← 顶层管道,把左侧结果当右侧 ctx
//   or_expr   → and_expr ('or' and_expr)*
//   and_expr  → cmp_expr ('and' cmp_expr)*
//   cmp_expr  → unary_expr (cmp_op unary_expr)?
//   unary_expr → 'not' unary_expr | postfix
//   postfix   → primary ('.' ident)*
//   primary   → '(' expr ')'
//             | 'true' / 'false'
//             | 'length' / 'count'
//             | 'any' / 'all' '(' arr ';' pred ')'
//             | '[' expr '|' 'select' '(' pred ')' ']'   (select pipeline)
//             | '[' expr ']'                              (透传)
//             | iter                                       (`units[]`)
//             | '.' ident                                  (字段访问)
//             | string / number literal
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[]
  private src: string
  private pos = 0

  constructor(tokens: Token[], src: string) {
    this.tokens = tokens
    this.src = src
  }

  parse(): Expr {
    if (this.tokens.length === 0) {
      throw new ExpressionSyntaxError(this.src, 'empty expression')
    }
    const e = this.parsePipe()
    if (this.pos < this.tokens.length) {
      const tok = this.peek()
      throw new ExpressionSyntaxError(
        this.src,
        `unexpected token '${tok?.value ?? 'EOF'}' at position ${this.pos}`,
      )
    }
    return e
  }

  private parsePipe(): Expr {
    let left = this.parseOr()
    while (this.match('pipe')) {
      const right = this.parseOr()
      left = { kind: 'pipe', left, right }
    }
    return left
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private consume(kind: TokenKind, value?: string): Token {
    const t = this.peek()
    if (!t || t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new ExpressionSyntaxError(
        this.src,
        `expected ${kind}${value ? ` '${value}'` : ''} but got '${t?.value ?? 'EOF'}' at position ${this.pos}`,
      )
    }
    this.pos++
    return t
  }

  private match(kind: TokenKind, value?: string): boolean {
    const t = this.peek()
    if (!t) return false
    if (t.kind !== kind) return false
    if (value !== undefined && t.value !== value) return false
    this.pos++
    return true
  }

  private parseOr(): Expr {
    let left = this.parseAnd()
    while (this.match('keyword', 'or')) {
      const right = this.parseAnd()
      left = { kind: 'logical', op: 'or', left, right }
    }
    return left
  }

  private parseAnd(): Expr {
    let left = this.parseCmp()
    while (this.match('keyword', 'and')) {
      const right = this.parseCmp()
      left = { kind: 'logical', op: 'and', left, right }
    }
    return left
  }

  private parseCmp(): Expr {
    const left = this.parseUnary()
    const t = this.peek()
    if (t && t.kind === 'op') {
      this.pos++
      const right = this.parseUnary()
      return { kind: 'binary', op: t.value as BinaryOp, left, right }
    }
    return left
  }

  private parseUnary(): Expr {
    if (this.match('keyword', 'not')) {
      const operand = this.parseUnary()
      return { kind: 'unary', op: 'not', operand }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    while (this.match('dot')) {
      const fieldTok = this.consume('ident')
      e = { kind: 'field', name: fieldTok.value }
    }
    return e
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (!t) throw new ExpressionSyntaxError(this.src, 'unexpected EOF')

    if (t.kind === 'lparen') {
      this.pos++
      const inner = this.parseOr()
      this.consume('rparen')
      return { kind: 'paren', inner }
    }

    if (t.kind === 'keyword' && t.value === 'true') {
      this.pos++
      return { kind: 'bool', value: true }
    }
    if (t.kind === 'keyword' && t.value === 'false') {
      this.pos++
      return { kind: 'bool', value: false }
    }

    if (t.kind === 'keyword' && (t.value === 'length' || t.value === 'count')) {
      this.pos++
      // length / count 在量词 / select 之后才有 operand;
      // 顶层调用时,operand 用 ctx 自身(在 evaluate 时处理)。
      // 这里我们把 operand 留一个 placeholder (iter),evaluate 时按 ctx 处理。
      return { kind: 'length', operand: { kind: 'iter' } }
    }

    if (t.kind === 'keyword' && (t.value === 'any' || t.value === 'all')) {
      const kindKw = t.value
      this.pos++
      this.consume('lparen')
      const arr = this.parseOr() // 数组表达式(iter / select 等)
      this.consume('semicolon')
      const pred = this.parseOr()
      this.consume('rparen')
      return { kind: kindKw, arr, pred }
    }

    if (t.kind === 'string') {
      this.pos++
      return { kind: 'string', value: t.value }
    }
    if (t.kind === 'number') {
      this.pos++
      return { kind: 'number', value: Number(t.value) }
    }

    if (t.kind === 'dot') {
      this.pos++
      const fieldTok = this.consume('ident')
      return { kind: 'field', name: fieldTok.value }
    }

    if (t.kind === 'lbracket') {
      this.pos++
      // [X | select(pred)]  —— select pipeline
      // [X]                —— 透传
      // [..., ...]         —— 数组字面量(本期未明确支持,走透传)
      const inner = this.parseOr()
      if (this.match('pipe')) {
        // 期待 select(...)
        const kwTok = this.peek()
        if (!kwTok || kwTok.kind !== 'keyword' || kwTok.value !== 'select') {
          throw new ExpressionSyntaxError(
            this.src,
            `expected 'select' after '|' but got '${kwTok?.value ?? 'EOF'}' at position ${this.pos}`,
          )
        }
        this.pos++ // consume 'select'
        this.consume('lparen')
        const pred = this.parseOr()
        this.consume('rparen')
        this.consume('rbracket')
        return { kind: 'select', arr: inner, pred }
      }
      this.consume('rbracket')
      return inner
    }

    if (t.kind === 'ident') {
      // `units[]` —— iter 标记
      if (t.value === 'units' && this.peek(1)?.kind === 'lbracket' && this.peek(2)?.kind === 'rbracket') {
        this.pos += 3
        return { kind: 'iter' }
      }
      throw new ExpressionSyntaxError(
        this.src,
        `unexpected identifier '${t.value}' at position ${this.pos}; bare identifiers are not allowed`,
      )
    }

    throw new ExpressionSyntaxError(
      this.src,
      `unexpected token '${t.value}' at position ${this.pos}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/** `evaluateExpression` 接受的 ctx 形态:judgment 列表 或 单 judgment */
export type EvaluateContext = UnitJudgment[] | UnitJudgment

/** judgment-shape 类型守卫 —— 在 `asArray` / `pipe` 中复用 */
function judgmentLike(v: unknown): v is UnitJudgment {
  if (!v || typeof v !== 'object') return false
  if (Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o['id'] === 'string' && 'verdict' in o
}

function asArray(v: unknown): UnitJudgment[] {
  if (Array.isArray(v)) return v as UnitJudgment[]
  if (judgmentLike(v)) return [v]
  return []
}

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function evaluateAST(expr: Expr, ctx: EvaluateContext): unknown {
  switch (expr.kind) {
    case 'iter':
      // 当前 judgment 数组(若 ctx 是单条 judgment 则包成 1 元素)
      if (Array.isArray(ctx)) return ctx
      if (judgmentLike(ctx)) return [ctx]
      return []
    case 'field': {
      if (!judgmentLike(ctx) && !isObjectRecord(ctx)) {
        throw new ExpressionSyntaxError(
          '<field>',
          `cannot access .${expr.name} on non-object context`,
        )
      }
      return (ctx as Record<string, unknown>)[expr.name]
    }
    case 'string':
      return expr.value
    case 'number':
      return expr.value
    case 'bool':
      return expr.value
    case 'paren':
      return evaluateAST(expr.inner, ctx)
    case 'unary': {
      const v = evaluateAST(expr.operand, ctx)
      return !toBool(v)
    }
    case 'binary': {
      const l = evaluateAST(expr.left, ctx)
      const r = evaluateAST(expr.right, ctx)
      switch (expr.op) {
        case '==':
          return l === r
        case '!=':
          return l !== r
        case '<':
          return toNum(l) < toNum(r)
        case '>':
          return toNum(l) > toNum(r)
        case '<=':
          return toNum(l) <= toNum(r)
        case '>=':
          return toNum(l) >= toNum(r)
      }
      return false
    }
    case 'logical': {
      const l = toBool(evaluateAST(expr.left, ctx))
      if (expr.op === 'and' && !l) return false
      if (expr.op === 'or' && l) return true
      return toBool(evaluateAST(expr.right, ctx))
    }
    case 'pipe': {
      // 左侧求值 → 把结果当右侧的 ctx(数组或 judgment)
      const lVal = evaluateAST(expr.left, ctx)
      let nextCtx: EvaluateContext
      if (Array.isArray(lVal)) nextCtx = lVal as UnitJudgment[]
      else if (judgmentLike(lVal)) nextCtx = lVal
      else {
        throw new ExpressionSyntaxError(
          '<pipe>',
          `cannot pipe value of kind '${typeof lVal}' into next expression`,
        )
      }
      return evaluateAST(expr.right, nextCtx)
    }
    case 'any': {
      const arrVal = evaluateAST(expr.arr, ctx)
      const arr = asArray(arrVal)
      for (const item of arr) {
        if (toBool(evaluateAST(expr.pred, item))) return true
      }
      return false
    }
    case 'all': {
      const arrVal = evaluateAST(expr.arr, ctx)
      const arr = asArray(arrVal)
      for (const item of arr) {
        if (!toBool(evaluateAST(expr.pred, item))) return false
      }
      return true
    }
    case 'select': {
      const arrVal = evaluateAST(expr.arr, ctx)
      const arr = asArray(arrVal)
      const out: UnitJudgment[] = []
      for (const item of arr) {
        if (toBool(evaluateAST(expr.pred, item))) out.push(item)
      }
      return out
    }
    case 'length': {
      // operand 为 iter 时,operand 直接用 ctx;否则用 operand 在 ctx 上求值
      const arrVal =
        expr.operand.kind === 'iter' ? ctx : evaluateAST(expr.operand, ctx)
      if (Array.isArray(arrVal)) return arrVal.length
      if (typeof arrVal === 'string') return arrVal.length
      throw new ExpressionSyntaxError(
        '<length>',
        'length operand must be array or string',
      )
    }
  }
}

/** 真值化 —— undefined / null / false / 0 / '' 当 false,其余 true */
function toBool(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** 数值化 —— 数字直通,字符串尝试 parse,其它当 0(jq 语义) */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

// ---------------------------------------------------------------------------
// 评估入口
// ---------------------------------------------------------------------------

/** 评估表达式 —— 顶层入口 */
export function evaluateExpression(expression: string, ctx: EvaluateContext): unknown {
  const tokens = tokenize(expression)
  const ast = new Parser(tokens, expression).parse()
  return evaluateAST(ast, ctx)
}

// ---------------------------------------------------------------------------
// runAlgorithm —— 完整算法执行器
// ---------------------------------------------------------------------------

export interface RunAlgorithmOptions {
  /** 算法对应的包 id,塞到 PackVerdict.packId */
  packId?: string
  /** 当前时间(可注入测试);默认 `new Date().toISOString()` */
  now?: () => string
}

/** 跑一遍算法:rules[0..n] 命中即返回,否则走 else */
export function runAlgorithm(
  algorithm: AdmissionAlgorithm,
  units: readonly UnitJudgment[],
  packId?: string,
  opts: Omit<RunAlgorithmOptions, 'packId'> = {},
): PackVerdict {
  const ctx: UnitJudgment[] = [...units]
  for (const rule of algorithm.rules) {
    const hit = evaluateExpression(rule.when, ctx)
    if (toBool(hit)) {
      return {
        packId: packId ?? algorithm.id,
        verdict: rule.result,
        reason: rule.reason,
        hitRuleId: rule.id,
        computedAt: (opts.now ?? defaultNow)(),
      }
    }
  }
  const elseBranch = algorithm.else
  return {
    packId: packId ?? algorithm.id,
    verdict: elseBranch.result,
    reason: elseBranch.reason,
    hitRuleId: undefined,
    computedAt: (opts.now ?? defaultNow)(),
  }
}

function defaultNow(): string {
  return new Date().toISOString()
}

// 类型守卫:Verdict 字符(供调用方 cast)
export function isVerdict(v: unknown): v is Verdict {
  return v === '✅' || v === '⚠️' || v === '❌'
}