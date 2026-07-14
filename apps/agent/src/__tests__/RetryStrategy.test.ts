import { describe, expect, it, vi } from 'vitest'
import { executeWithRetry, RetryFailure } from '../error/RetryStrategy.js'

describe('executeWithRetry', () => {
  it('retries A exactly three times with 1s/3s/10s and emits counters', async () => {
    const sleeps: number[] = []
    const retries: Array<{ retry: number; maxRetries: number; delayMs: number }> = []
    let calls = 0
    const result = await executeWithRetry(
      async () => {
        calls++
        if (calls < 4) throw { status: 429, type: 'rate_limit_error', message: 'slow down' }
        return 'ok'
      },
      {
        sleep: async (ms) => { sleeps.push(ms) },
        onRetry: (event) => { retries.push(event) },
      },
    )
    expect(result).toEqual({ value: 'ok', attempts: 4, retryDelaysMs: [1000, 3000, 10000] })
    expect(sleeps).toEqual([1000, 3000, 10000])
    expect(retries).toEqual([
      expect.objectContaining({ retry: 1, maxRetries: 3, delayMs: 1000 }),
      expect.objectContaining({ retry: 2, maxRetries: 3, delayMs: 3000 }),
      expect.objectContaining({ retry: 3, maxRetries: 3, delayMs: 10000 }),
    ])
  })

  it('retries C once and wraps the final failure with metadata', async () => {
    const operation = vi.fn(async () => { throw { code: 'ENOENT', message: 'spawn failed' } })
    await expect(executeWithRetry(operation, { sleep: async () => {} })).rejects.toMatchObject({
      name: 'RetryFailure', attempts: 2, retryDelaysMs: [1000],
      classification: expect.objectContaining({ category: 'C' }),
    })
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ status: 401, message: 'invalid api key' }, 'B'],
    [{ code: 'error_max_turns', message: 'max turns reached' }, 'E'],
  ])('does not retry %j', async (error, category) => {
    const operation = vi.fn(async () => { throw error })
    await expect(executeWithRetry(operation)).rejects.toBeInstanceOf(RetryFailure)
    expect(operation).toHaveBeenCalledTimes(1)
    await executeWithRetry(operation).catch((caught: unknown) => {
      expect((caught as RetryFailure).classification.category).toBe(category)
    })
  })

  it('does not schedule a retry when canRetry returns false', async () => {
    const onRetry = vi.fn()
    await expect(executeWithRetry(
      async () => { throw { status: 503, message: 'unavailable' } },
      { canRetry: () => false, onRetry },
    )).rejects.toBeInstanceOf(RetryFailure)
    expect(onRetry).not.toHaveBeenCalled()
  })
})

describe('executeWithRetry · initialDelayMs', () => {
  it('uses initialDelayMs=0 to skip first retry delay', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms)
    })
    let attempts = 0
    await expect(
      executeWithRetry(
        async () => {
          attempts++
          if (attempts < 2) throw { status: 429, type: 'rate_limit_error', message: 'slow down' }
          throw new Error('still bad')
        },
        {
          sleep: sleep as never,
          initialDelayMs: 0,
          canRetry: () => true,
        },
      ),
    ).rejects.toBeInstanceOf(RetryFailure)
    expect(delays[0]).toBe(0)
  })

  it('defaults initialDelayMs to 1000 (existing behavior unchanged)', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms)
    })
    let attempts = 0
    await expect(
      executeWithRetry(
        async () => {
          attempts++
          if (attempts < 2) throw { status: 429, type: 'rate_limit_error', message: 'slow down' }
          throw new Error('still bad')
        },
        { sleep: sleep as never, canRetry: () => true },
      ),
    ).rejects.toBeInstanceOf(RetryFailure)
    expect(delays[0]).toBe(1000)
  })
})
