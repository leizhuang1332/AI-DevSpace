/**
 * Provider-shared concurrency limiter.
 *
 * NOTE: Despite the historical name `CircuitBreaker`, this is a FIFO concurrency
 * semaphore — it caps the number of in-flight provider queries and queues
 * additional requests in arrival order. It does NOT trip on a failure rate and
 * does NOT behave like a failure-rate circuit breaker. The name is retained so
 * downstream wiring (ClaudeCodeProvider, DI graph) keeps a single injection
 * point across the provider layer.
 *
 * Behavior:
 * - `limit` concurrent operations (default 5).
 * - Excess callers await a release function in FIFO order.
 * - Releasing hands the slot directly to the next waiter (no active count dip).
 * - `AbortSignal` removes the waiter from the queue without consuming a slot.
 * - `close()` rejects all queued waiters and refuses new acquires.
 */
interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface CircuitBreakerStats {
  limit: number
  active: number
  queued: number
}

export class CircuitBreaker {
  readonly #limit: number
  #active = 0
  #closed = false
  #waiters: Waiter[] = []

  constructor(options: { limit?: number } = {}) {
    this.#limit = options.limit ?? 5
    if (!Number.isInteger(this.#limit) || this.#limit < 1) {
      throw new Error('CircuitBreaker limit must be a positive integer')
    }
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.#acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  stats(): CircuitBreakerStats {
    return { limit: this.#limit, active: this.#active, queued: this.#waiters.length }
  }

  close(reason: unknown = new Error('CircuitBreaker closed')): void {
    this.#closed = true
    const waiters = this.#waiters.splice(0)
    for (const waiter of waiters) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort)
      waiter.reject(reason)
    }
  }

  async #acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.#closed) throw new Error('CircuitBreaker is closed')
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (this.#active < this.#limit) {
      this.#active++
      return this.#releaseFactory()
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      waiter.abort = (): void => {
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        reject(new DOMException('aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', waiter.abort, { once: true })
      this.#waiters.push(waiter)
    })
  }

  #releaseFactory(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.#waiters.shift()
      if (next) {
        if (next.abort && next.signal) next.signal.removeEventListener('abort', next.abort)
        next.resolve(this.#releaseFactory())
      } else {
        this.#active--
      }
    }
  }
}
