/**
 * Analysis Query 临时错误自动重试包装(issue 07 · ADR-0021)
 *
 * 背景:`provider.runAnalysisQuery` 返 `{ok:false, error:string}` 时不区分
 * 临时 vs 永久错误。issue 07 要求:
 * - 临时错误(network / rate limit / 5xx / overloaded)在同一 Run 标识内
 *   自动重试,不创建新 Run,不重复 Issue(由 `tool_use_id` 进程内索引保证幂等)
 * - 永久错误(auth / billing / 4xx 等)直接终态 failed
 * - 不可重试(process / cancelled)直接终态 failed
 *
 * 设计:
 * - **不**复用 `executeWithRetry`(它基于 `throw` 语义 + 抛 RetryFailure):
 *   `runAnalysisQuery` 返 `{ok,error}` 不是抛;硬包装会模糊契约。
 * - **不**走 `classifyError`(它的输入是 error 链,不是字符串):
 *   provider 错误是字符串,需独立归类。
 * - 手写一个轻量循环:每次 attempt 调 `rawRun(attempt)`,失败时按分类
 *   决定是否重试,按 schedule 退避。可重试分类:
 *     - 包含 5xx / 408 / 429 / 'overloaded' / 'rate_limit' / 'timeout' /
 *       'transient' / 'retry' / 'network' / 'connection' / 'socket' → A/D
 *     - 包含 'enoent' / 'eacces' / 'eperm' / 'spawn' / 'process' / 'cli' → C
 *     - 其它 → B(永久)
 *
 * 契约:
 * - **同一 run_id 不变**:retry 期间不重写 `meta.yaml`,不重新创建 Run 目录
 * - **不写 log.jsonl**:本函数不操作 `appendLogEntry`(决策 37:retrying 不入 Log)
 * - **`onRetry` 钩子**:发 SSE `analysis_run_retrying` 事件
 * - **不接管 SDK 成功后的门禁**:complete_analysis 缺失 / 持久化失败 / 协议错误
 *   仍由 `AnalysisAgentRunner` 兜底
 */

import type { ClassifiedError, ErrorCategory } from '../error/ErrorClassifier.js'

/** Provider runAnalysisQuery 原生返回形态(ClaudeCodeProvider 与 fake 一致) */
export type RunAnalysisQueryOutcome =
  | { ok: true; issue_count: number }
  | { ok: false; error: string }

/** 内部包装后给 rawRun 的参数:与 provider.runAnalysisQuery 同形态 */
export type RawRunAttempt = (attempt: number) => Promise<RunAnalysisQueryOutcome>

export interface RunAnalysisQueryWithRetryOptions {
  signal?: AbortSignal
  /** 退避前触发(发 SSE 事件用);不在本函数内 publish,由调用方决定 */
  onRetry?: (info: {
    classification: ClassifiedError
    attempt: number
    delayMs: number
    error: string
  }) => void | Promise<void>
  /**
   * 测试可注入:用 0 / 极小值加速测试。
   * 不传 → 使用 ErrorClassifier 退避策略。
   */
  initialDelayMs?: number
  /**
   * 测试可注入:替代默认 `classifyProviderError`。
   * 必须返回带 category/retryable/maxRetries 的 ClassifiedError。
   */
  classifyOverride?: (error: string) => ClassifiedError
  /**
   * 退避 sleep;默认用 ErrorClassifier 风格的 abortable sleep。
   * 测试可注入 `async () => {}` 跳过等待。
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export type RunAnalysisQueryWithRetryResult =
  | { ok: true; issue_count: number; attempts: number }
  | {
      ok: false
      error: string
      attempts: number
      classification: ClassifiedError
    }

/** A/D 错误退避表(沿用 ErrorClassifier GENERAL_DELAYS) */
const A_D_DELAYS_MS = [1000, 3000, 10000] as const
/** C 错误退避表(沿用 ErrorClassifier PROCESS_DELAYS) */
const C_DELAYS_MS = [1000] as const

/**
 * 同步分类 provider 错误字符串。
 *
 * 与 `ErrorClassifier.classifyError` 互补:后者处理 error 链 / Error 对象,
 * 这里处理 SDK 透传过来的纯字符串(ClaudeCodeProvider.runAnalysisQuery 当前
 * 实现只暴露字符串)。规则尽量与原分类器保持一致。
 */
export function classifyProviderError(error: string): ClassifiedError {
  const e = String(error ?? '').toLowerCase()
  // cancelled
  if (
    e.includes('abort') ||
    e.includes('cancelled') ||
    e.includes('canceled') ||
    e === 'aborted'
  ) {
    return result('cancelled', 'cancelled', error, false, 0, error)
  }
  // E (business-dead)
  if (
    /max[_-]?turns|agent[_-]?(abandoned|gave[_-]?up)|max[_-]?budget|max[_-]?structured/.test(e)
  ) {
    return result('E', 'business_dead', error, false, 0, error)
  }
  // C (process)
  if (
    /enoent|eacces|eperm|spawn|cli[_-]?exited|process[_-]?exited|exit[_-]?code/.test(e)
  ) {
    return result('C', 'process', error, true, C_DELAYS_MS.length, error)
  }
  // A (transient: 5xx/408/429/overloaded/rate_limit)
  if (
    /\b(500|501|502|503|504|505|506|507|508|510|511)\b/.test(e) ||
    /\b(408|429)\b/.test(e) ||
    /overloaded|rate[_-]?limit|api[_-]?timeout|server[_-]?error|api[_-]?error/.test(e) ||
    /transient|retry[_-]?after/.test(e)
  ) {
    return result('A', 'api_transient', error, true, A_D_DELAYS_MS.length, error)
  }
  // D (network)
  if (
    /econnreset|econnrefused|epipe|enotfound|eai_again|etimedout|network|socket|connection[_-]?(reset|refused|lost|closed)|timeout/.test(
      e,
    )
  ) {
    return result('D', 'network', error, true, A_D_DELAYS_MS.length, error)
  }
  // B (business permanent: auth/billing/permission)
  if (
    /auth(entication|orized|orized)|billing|quota|out[_-]?of[_-]?credits|permission[_-]?denied|invalid[_-]?api[_-]?key|credentials/.test(
      e,
    )
  ) {
    return result('B', 'business', error, false, 0, error)
  }
  // 其它 4xx → B
  if (/\b4\d\d\b/.test(e)) {
    return result('B', 'business_4xx', error, false, 0, error)
  }
  // 默认 → B(保守,不重试)
  return result('B', 'unknown_permanent', error, false, 0, error)
}

function result(
  category: ErrorCategory,
  code: string,
  message: string,
  retryable: boolean,
  maxRetries: number,
  original: unknown,
): ClassifiedError {
  return { category, code, message, retryable, maxRetries, original }
}

/**
 * 默认 abortable sleep;AbortSignal.aborted 时抛 AbortError。
 */
async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * 在指定分类下选择退避时长。
 *
 * - 第 N 次重试(attempt = N+1) → 走 schedule[N-1]
 * - schedule 用尽 → caller 决定是否继续(本函数返回该 schedule 末值,
 *   但 executeWithRetry 风格仅在 allowed 时才调本函数)
 */
function pickDelayMs(
  classification: ClassifiedError,
  retryIndex: number,
  initialDelayMs: number,
): number {
  // retryIndex: 1-based
  if (classification.category === 'C') {
    return C_DELAYS_MS[Math.min(retryIndex - 1, C_DELAYS_MS.length - 1)]
  }
  if (classification.category === 'A' || classification.category === 'D') {
    return A_D_DELAYS_MS[Math.min(retryIndex - 1, A_D_DELAYS_MS.length - 1)]
  }
  return initialDelayMs
}

/**
 * 跑 rawRun(attempt) 在 transient 错误时自动重试,最终返回
 * `{ok, issue_count, attempts}` 或 `{ok:false, error, attempts, classification}`。
 */
export async function runAnalysisQueryWithRetry(
  rawRun: RawRunAttempt,
  options: RunAnalysisQueryWithRetryOptions = {},
): Promise<RunAnalysisQueryWithRetryResult> {
  const classify = options.classifyOverride ?? classifyProviderError
  const sleep = options.sleep ?? defaultSleep
  const initialDelayMs = options.initialDelayMs ?? 1000
  // 上限 = 1 次初次 + 该分类 maxRetries 次重试
  // A/D maxRetries=3 → 4 次 attempt;C maxRetries=1 → 2 次 attempt
  let attempt = 0

  while (true) {
    attempt++
    let outcome: RunAnalysisQueryOutcome
    try {
      outcome = await rawRun(attempt)
    } catch (err) {
      // rawRun 自身抛错(SDK 内部崩 / AbortError)→ 走 cancelled 路径
      const message = err instanceof Error ? err.message : String(err)
      const classification = classify(message)
      return { ok: false, error: message, attempts: attempt, classification }
    }

    if (outcome.ok) {
      return { ok: true, issue_count: outcome.issue_count, attempts: attempt }
    }

    // outcome.ok === false
    const error = outcome.error
    const classification = classify(error)

    // 不可重试 → 终态
    if (!classification.retryable) {
      return { ok: false, error, attempts: attempt, classification }
    }

    // 已用尽 attempt 上限 → 终态
    // maxAttempts = 1 + maxRetries(沿用 ErrorClassifier 的 schedule 长度)
    const maxAttempts = 1 + classification.maxRetries
    if (attempt >= maxAttempts) {
      return { ok: false, error, attempts: attempt, classification }
    }

    // 第 N 次重试(1-based) → 走 schedule[N-1]
    const retryIndex = attempt
    const delayMs = pickDelayMs(classification, retryIndex, initialDelayMs)

    await options.onRetry?.({ classification, attempt, delayMs, error })
    await sleep(delayMs, options.signal)
  }
}
