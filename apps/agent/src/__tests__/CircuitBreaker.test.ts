import { describe, expect, it, vi } from 'vitest'
import { CircuitBreaker } from '../error/CircuitBreaker.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('CircuitBreaker', () => {
  it('runs five operations and queues the sixth until a slot is released', async () => {
    const breaker = new CircuitBreaker({ limit: 5 })
    const gates = Array.from({ length: 6 }, deferred)
    const started: number[] = []
    const jobs = gates.map((gate, index) => breaker.run(async () => {
      started.push(index)
      await gate.promise
      return index
    }))
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(breaker.stats()).toEqual({ limit: 5, active: 5, queued: 1 })
    gates[0].resolve()
    await jobs[0]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3, 4, 5])
    gates.slice(1).forEach((gate) => gate.resolve())
    await Promise.all(jobs)
  })

  it('serves queued operations in FIFO order and releases on rejection', async () => {
    const breaker = new CircuitBreaker({ limit: 1 })
    const gate = deferred()
    const order: string[] = []
    const first = breaker.run(async () => { await gate.promise; throw new Error('boom') })
    const second = breaker.run(async () => { order.push('second') })
    const third = breaker.run(async () => { order.push('third') })
    gate.resolve()
    await expect(first).rejects.toThrow('boom')
    await Promise.all([second, third])
    expect(order).toEqual(['second', 'third'])
  })

  it('removes an aborted waiter without consuming a slot', async () => {
    const breaker = new CircuitBreaker({ limit: 1 })
    const gate = deferred()
    const first = breaker.run(async () => { await gate.promise })
    const controller = new AbortController()
    const operation = vi.fn(async () => {})
    const waiting = breaker.run(operation, controller.signal)
    controller.abort('user')
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(breaker.stats().queued).toBe(0)
    gate.resolve()
    await first
    expect(operation).not.toHaveBeenCalled()
  })
})
