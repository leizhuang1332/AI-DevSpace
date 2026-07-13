/**
 * WriteQueue tests —— ADR-0010 Q4 (P1 写队列)
 *
 * 覆盖:
 *  - FIFO:同一 req 的写操作串行执行
 *  - per-req 隔离:不同 req 的写操作互不干扰
 *  - 错误不卡队列:写失败后队列仍能继续接活
 *  - 返回值:execWriteTool 返回的 promise resolve/reject 与工具调用一致
 *  - 并发入口:同一时刻多次 enqueue 仍能保证 FIFO 顺序
 *  - cancel:清除某 req 的等待队列(对其他 req 无影响)
 */

import { describe, it, expect, vi } from 'vitest'
import { createWriteQueue, type WriteRunner } from '../worktree/WriteQueue.js'

/** 构造一个工具调用 payload */
function toolCall(id: string): { name: 'Edit'; input: { file_path: string } } {
  return {
    name: 'Edit',
    input: { file_path: `/tmp/x/${id}.java` },
  }
}

/** 一个可控的 tool runner,按 calls 顺序执行,可通过 resolveOne 推进 */
function makeRunner() {
  const calls: Array<{ reqId: string; tc: { name: string; input: { file_path: string } } }> = []
  /** 每个 tool call 触发其对应 resolver */
  const resolvers: Array<(v: unknown) => void> = []
  const rejecters: Array<(e: unknown) => void> = []

  const runner = vi.fn<WriteRunner>(async (reqId, tc) => {
    calls.push({ reqId, tc })
    return new Promise((resolve, reject) => {
      resolvers.push(resolve)
      rejecters.push(reject)
    })
  })

  return {
    runner,
    calls,
    resolveOne(idx: number, value: unknown) {
      resolvers[idx]?.(value)
    },
    rejectOne(idx: number, err: unknown) {
      rejecters[idx]?.(err)
    },
  }
}

describe('createWriteQueue', () => {
  it('serializes write tool calls per req in FIFO order', async () => {
    const { runner, calls, resolveOne } = makeRunner()
    const queue = createWriteQueue({ run: runner })

    const p1 = queue.exec('req-1', toolCall('1'))
    const p2 = queue.exec('req-1', toolCall('2'))
    const p3 = queue.exec('req-1', toolCall('3'))

    // 等 runner 触发第一次调用(.then 是 microtask)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].tc.input.file_path).toBe('/tmp/x/1.java')

    resolveOne(0, 'r1')
    await p1

    // p2 解锁后触发 call #2
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].tc.input.file_path).toBe('/tmp/x/2.java')
    resolveOne(1, 'r2')
    await p2

    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].tc.input.file_path).toBe('/tmp/x/3.java')
    resolveOne(2, 'r3')
    await p3
  })

  it('different reqs run in parallel (no cross-blocking)', async () => {
    const { runner, calls, resolveOne } = makeRunner()
    const queue = createWriteQueue({ run: runner })

    const pa = queue.exec('req-A', toolCall('A1'))
    const pb = queue.exec('req-B', toolCall('B1'))

    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map((c) => c.reqId).sort()).toEqual(['req-A', 'req-B'])

    resolveOne(0, 'a')
    resolveOne(1, 'b')
    await Promise.all([pa, pb])
  })

  it('failed write does not block subsequent writes for the same req', async () => {
    const { runner, calls, resolveOne, rejectOne } = makeRunner()
    const queue = createWriteQueue({ run: runner })

    const p1 = queue.exec('req-1', toolCall('1'))
    const p2 = queue.exec('req-1', toolCall('2'))

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    rejectOne(0, new Error('disk full'))

    // p1 必须 reject
    await expect(p1).rejects.toThrow('disk full')

    // p2 仍能继续 —— 队列没被卡死
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].tc.input.file_path).toBe('/tmp/x/2.java')
    resolveOne(1, 'ok')
    await expect(p2).resolves.toBe('ok')
  })

  it('returns the runner result to the caller', async () => {
    const { runner, calls, resolveOne } = makeRunner()
    const queue = createWriteQueue({ run: runner })

    const p = queue.exec('req-1', toolCall('1'))
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    resolveOne(0, { fileWritten: true, lines: 42 })
    await expect(p).resolves.toEqual({ fileWritten: true, lines: 42 })
  })

  it('10 concurrent calls for one req execute strictly in order', async () => {
    const order: number[] = []
    const runner = vi.fn<WriteRunner>(async (_reqId, tc) => {
      const path = (tc.input as { file_path: string }).file_path
      const id = Number(path.split('/').pop()!.replace('.java', ''))
      order.push(id)
    })
    const queue = createWriteQueue({ run: runner })

    const promises: Array<Promise<unknown>> = []
    for (let i = 1; i <= 10; i++) {
      promises.push(queue.exec('req-1', toolCall(String(i))))
    }
    await Promise.all(promises)

    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('two reqs each running 5 calls in parallel finish without interleaving per req', async () => {
    const perReq: Record<string, number[]> = { 'req-A': [], 'req-B': [] }
    const runner = vi.fn<WriteRunner>(async (reqId, tc) => {
      const path = (tc.input as { file_path: string }).file_path
      // 从 /tmp/x/A3.java 这类文件名取末尾数字
      const id = Number(/(\d+)\.java$/.exec(path)?.[1] ?? 'NaN')
      perReq[reqId].push(id)
    })
    const queue = createWriteQueue({ run: runner })

    const promises: Array<Promise<unknown>> = []
    for (const req of ['req-A', 'req-B'] as const) {
      for (let i = 1; i <= 5; i++) {
        const prefix = req === 'req-A' ? 'A' : 'B'
        promises.push(queue.exec(req, toolCall(`${prefix}${i}`)))
      }
    }
    await Promise.all(promises)

    expect(perReq['req-A']).toEqual([1, 2, 3, 4, 5])
    expect(perReq['req-B']).toEqual([1, 2, 3, 4, 5])
  })

  it('cancel(reqId) clears the pending tail for that req only', async () => {
    const { runner, calls, resolveOne } = makeRunner()
    const queue = createWriteQueue({ run: runner })

    const pA = queue.exec('req-A', toolCall('A1'))
    const pB = queue.exec('req-B', toolCall('B1'))

    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(queue.size()).toBe(2)

    expect(queue.cancel('req-A')).toBe(true)
    expect(queue.size()).toBe(1)
    expect(queue.cancel('req-nope')).toBe(false)

    resolveOne(0, 'ok')
    resolveOne(1, 'ok')
    await Promise.all([pA, pB])
  })

  it('cancel(reqId) lets subsequent enqueue start fresh (in-flight + already-chained continue)', async () => {
    // cancel 语义(对齐 WriteQueue.cancel JSDoc):
    //   - 在飞的 call 与 cancel 之前已 chain 的 pending call 继续跑(不受影响)
    //   - cancel 之后的 enqueue 从 Promise.resolve() 开始,不再串行等待
    //   - size() 立即清零
    //
    // 验证:用一个慢的 p1 + cancel + 立刻 enqueue p3,断言 p3 在 p1 之前完成
    //     —— 如果 cancel 没生效,p3 会卡在 p1 后面,finish 顺序会反过来。
    const order: string[] = []
    let slowResolve!: () => void
    const slowGate = new Promise<void>((r) => {
      slowResolve = r
    })
    const runner = vi.fn<WriteRunner>(async (_reqId, tc) => {
      const path = (tc.input as { file_path: string }).file_path
      if (path === '/slow') await slowGate
      order.push(path)
    })
    const queue = createWriteQueue({ run: runner })

    // p1 慢 / p2 已在队列里 / cancel / p3 新 enqueue
    const p1 = queue.exec('req-1', { name: 'Edit', input: { file_path: '/slow' } })
    const p2 = queue.exec('req-1', { name: 'Edit', input: { file_path: '/pending' } })

    // 等 p1 in-flight
    await vi.waitFor(() =>
      expect(runner.mock.calls.length).toBeGreaterThanOrEqual(1),
    )

    expect(queue.cancel('req-1')).toBe(true)
    expect(queue.size()).toBe(0)

    // cancel 之后立刻 enqueue p3 —— 关键:它应该立即被派活(不等 p1)
    const p3 = queue.exec('req-1', { name: 'Edit', input: { file_path: '/fresh' } })
    await vi.waitFor(() => expect(runner.mock.calls.length).toBeGreaterThanOrEqual(2))

    // 此时 p3 已触发(cancel 后从 Promise.resolve() 起跳)
    // p2 也已经触发(cancel 之前已 chain)
    // 放行 p1
    slowResolve()

    await Promise.all([p1, p2, p3])

    // 顺序断言:p3 必须在 p1 之前完成
    const idxSlow = order.indexOf('/slow')
    const idxFresh = order.indexOf('/fresh')
    expect(idxFresh).toBeLessThan(idxSlow)
  })
})