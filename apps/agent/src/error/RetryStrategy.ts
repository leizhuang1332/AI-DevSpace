import { classifyError, type ClassifiedError } from './ErrorClassifier.js'

export interface RetryEvent {
  classification: ClassifiedError
  retry: number
  maxRetries: number
  delayMs: number
}

export interface RetryExecution<T> {
  value: T
  attempts: number
  retryDelaysMs: number[]
}

export interface ExecuteWithRetryOptions {
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  onRetry?: (event: RetryEvent) => void | Promise<void>
  canRetry?: (error: unknown, classification: ClassifiedError) => boolean
}

export class RetryFailure extends Error {
  readonly classification: ClassifiedError
  readonly attempts: number
  readonly retryDelaysMs: number[]

  constructor(classification: ClassifiedError, attempts: number, retryDelaysMs: number[]) {
    super(classification.message, { cause: classification.original })
    this.name = 'RetryFailure'
    this.classification = classification
    this.attempts = attempts
    this.retryDelaysMs = retryDelaysMs
  }
}

const GENERAL_DELAYS = [1000, 3000, 10000] as const
const PROCESS_DELAYS = [1000] as const

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: ExecuteWithRetryOptions = {},
): Promise<RetryExecution<T>> {
  const sleep = options.sleep ?? abortableSleep
  const retryDelaysMs: number[] = []
  let attempts = 0

  while (true) {
    attempts++
    try {
      const value = await operation(attempts)
      return { value, attempts, retryDelaysMs }
    } catch (error) {
      const classification = classifyError(error, options.signal)
      const schedule = classification.category === 'C'
        ? PROCESS_DELAYS
        : classification.category === 'A' || classification.category === 'D'
          ? GENERAL_DELAYS
          : []
      const retry = attempts
      const allowed = classification.retryable
        && retry <= schedule.length
        && (options.canRetry?.(error, classification) ?? true)
      if (!allowed) throw new RetryFailure(classification, attempts, retryDelaysMs)

      const delayMs = schedule[retry - 1]
      await options.onRetry?.({
        classification,
        retry,
        maxRetries: schedule.length,
        delayMs,
      })
      retryDelaysMs.push(delayMs)
      await sleep(delayMs, options.signal)
    }
  }
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
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
