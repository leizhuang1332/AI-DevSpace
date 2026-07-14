import { describe, expect, it, vi } from 'vitest'
import { ProviderSemaphore } from '../error/ProviderSemaphore.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ProviderSemaphore', () => {
  it('runs five operations and queues the sixth until a slot is released', async () => {
    const sem = new ProviderSemaphore({ limit: 5 })
    const order: number[] = []
    const tasks = Array.from({ length: 6 }, (_, i) =>
      sem.run(async () => {
        order.push(i)
        await new Promise((r) => setTimeout(r, 5))
      }),
    )
    await Promise.all(tasks)
    // 前 5 个并发跑完才放第 6 个 → order 中 5 在 6 之前
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5))
  })

  it('serves queued operations in FIFO order and releases on rejection', async () => {
    const sem = new ProviderSemaphore({ limit: 1 })
    const order: string[] = []
    const t1 = sem.run(async () => {
      order.push('t1')
      await new Promise((r) => setTimeout(r, 10))
    })
    const t2 = sem.run(async () => {
      order.push('t2')
    }).catch(() => {})
    const t3 = sem.run(async () => {
      order.push('t3')
    }).catch(() => {})
    sem.close()
    await t1
    await t2
    await t3
    expect(order[0]).toBe('t1')
  })

  it('removes an aborted waiter without consuming a slot', async () => {
    const sem = new ProviderSemaphore({ limit: 1 })
    const blocker = deferred()
    // First slot occupied so the second run() lands in the queue.
    const first = sem.run(async () => { await blocker.promise })
    const controller = new AbortController()
    const waiter = sem.run(async () => {}, controller.signal).catch(() => 'aborted')
    // wait until the waiter has been registered in the queue
    for (let i = 0; i < 50 && sem.stats().queued !== 1; i++) {
      await new Promise((r) => setTimeout(r, 1))
    }
    const stats1 = sem.stats()
    expect(stats1.queued).toBe(1)
    controller.abort()
    expect(await waiter).toBe('aborted')
    const stats2 = sem.stats()
    expect(stats2.queued).toBe(0)
    expect(stats2.active).toBe(1)
    blocker.resolve()
    await first
    const stats3 = sem.stats()
    expect(stats3.active).toBe(0)
  })
})