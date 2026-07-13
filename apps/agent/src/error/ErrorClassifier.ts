export type ErrorCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'cancelled'

export interface ClassifiedError {
  category: ErrorCategory
  code: string
  message: string
  retryable: boolean
  maxRetries: number
  original: unknown
}

const PROCESS_CODES = new Set(['ENOENT', 'EACCES', 'EPERM'])
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'])
const API_TRANSIENT_CODES = new Set(['rate_limit', 'rate_limit_error', 'overloaded', 'overloaded_error', 'server_error', 'api_error', 'API_TIMEOUT'])
const BUSINESS_CODES = new Set([
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
  'agent_abandoned',
  'agent_gave_up',
])

export function classifyError(error: unknown, signal?: AbortSignal): ClassifiedError {
  const chain = errorChain(error)
  const code = firstString(chain, ['code', 'errorCode', 'type', 'subtype']) ?? 'unknown_error'
  const message = firstString(chain, ['message']) ?? String(error)
  const name = firstString(chain, ['name'])
  const status = firstNumber(chain, ['status', 'statusCode', 'error_status'])
  const exitCode = firstNumber(chain, ['exitCode', 'exit_code'])
  const normalized = `${code} ${message}`.toLowerCase()

  if (signal?.aborted || name === 'AbortError' || code === 'ABORT_ERR') {
    return result('cancelled', code, message, false, 0, error)
  }
  if (BUSINESS_CODES.has(code) || /max turns|agent (abandoned|gave up)/i.test(message)) {
    return result('E', code, message, false, 0, error)
  }
  if (PROCESS_CODES.has(code) || (exitCode !== undefined && exitCode !== 0) || /spawn|cli exited|process exited/i.test(message)) {
    return result('C', code, message, true, 1, error)
  }
  if (NETWORK_CODES.has(code) || /socket|connection reset|connection refused|network error/i.test(message)) {
    return result('D', code, message, true, 3, error)
  }
  if (/billing|quota exhausted|out of credits|credits required|invalid api key|authentication|permission denied/.test(normalized)) {
    return result('B', code, message, false, 0, error)
  }
  if (status === 408 || status === 429 || (status !== undefined && status >= 500) || API_TRANSIENT_CODES.has(code)) {
    return result('A', code, message, true, 3, error)
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return result('B', code, message, false, 0, error)
  }
  return result('B', code, message, false, 0, error)
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

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const record = current as Record<string, unknown>
    chain.push(record)
    current = record['cause']
  }
  return chain
}

function firstString(chain: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of chain) {
    for (const key of keys) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return undefined
}

function firstNumber(chain: Array<Record<string, unknown>>, keys: string[]): number | undefined {
  for (const record of chain) {
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key]
    }
  }
  return undefined
}
