/**
 * toolExecutor tests —— ADR-0010 Q4 (P1 工具执行器)
 *
 * 覆盖:
 *  - 写类工具(Edit / Write / NotebookEdit / Bash 写)→ WriteQueue 串行
 *  - 读类工具(Read / Grep / Glob / Bash 读)→ 直接执行,不排队
 *  - 同一 req 的写工具 FIFO 串行
 *  - 不同 req 的写工具互不干扰
 *  - 读工具并发执行(不受写队列影响)
 *  - 写工具返回值透传
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createToolExecutor,
  type ToolExecutor,
  type RawToolCall,
} from '../worktree/toolExecutor.js'

/** 读 runner —— 记录调用,直接返回结果 */
function makeReadRunner() {
  const calls: RawToolCall[] = []
  const runner = vi.fn(async (_reqId: string, tc: RawToolCall) => {
    calls.push(tc)
    return { kind: 'read-result', name: tc.name }
  })
  return { runner, calls }
}

function toolCall(name: string, input: unknown = {}): RawToolCall {
  return { name, input }
}

describe('createToolExecutor', () => {
  it('routes write tools through WriteQueue (serial per req)', async () => {
    const { runner: readRunner, calls: readCalls } = makeReadRunner()
    const writeRunner = vi.fn(async () => 'write-result')
    const exec: ToolExecutor = createToolExecutor({
      readRunner,
      writeRunner,
    })

    // Edit 是写工具 → 应进入 writeQueue
    const p1 = exec.exec('req-1', toolCall('Edit', { file_path: '/a' }))
    const p2 = exec.exec('req-1', toolCall('Edit', { file_path: '/b' }))

    // writeRunner 还没被触发(readRunner 同理)
    expect(writeRunner).not.toHaveBeenCalled()
    expect(readCalls).toHaveLength(0)

    // 两个 promise 都应 resolve
    await expect(p1).resolves.toBe('write-result')
    await expect(p2).resolves.toBe('write-result')
    expect(writeRunner).toHaveBeenCalledTimes(2)
  })

  it('routes read tools directly (no queue, parallel)', async () => {
    const { runner: readRunner, calls: readCalls } = makeReadRunner()
    const writeRunner = vi.fn(async () => 'write-result')
    const exec = createToolExecutor({ readRunner, writeRunner })

    const p1 = exec.exec('req-1', toolCall('Read', { file_path: '/a' }))
    const p2 = exec.exec('req-1', toolCall('Grep', { pattern: 'x' }))
    const p3 = exec.exec('req-1', toolCall('Glob', { pattern: '*.ts' }))

    // readRunner 应立即全部触发(并发)
    expect(readCalls).toHaveLength(3)
    expect(readCalls.map((c) => c.name).sort()).toEqual(['Glob', 'Grep', 'Read'])
    expect(writeRunner).not.toHaveBeenCalled()

    await Promise.all([p1, p2, p3])
  })

  it('classifies Bash with write command as write', async () => {
    const readRunner = vi.fn(async () => 'r')
    const writeRunner = vi.fn(async () => 'w')
    const exec = createToolExecutor({ readRunner, writeRunner })

    await exec.exec('r', toolCall('Bash', { command: 'rm /tmp/x' }))
    expect(writeRunner).toHaveBeenCalledTimes(1)
    expect(readRunner).not.toHaveBeenCalled()
  })

  it('classifies Bash with pure read command as read', async () => {
    const readRunner = vi.fn(async () => 'r')
    const writeRunner = vi.fn(async () => 'w')
    const exec = createToolExecutor({ readRunner, writeRunner })

    await exec.exec('r', toolCall('Bash', { command: 'ls -la' }))
    expect(readRunner).toHaveBeenCalledTimes(1)
    expect(writeRunner).not.toHaveBeenCalled()
  })

  it('serializes 3 write tool calls per req in order', async () => {
    const order: string[] = []
    const readRunner = vi.fn(async () => 'r')
    const writeRunner = vi.fn(async (_reqId: string, tc: RawToolCall) => {
      order.push((tc.input as { file_path: string }).file_path)
      return 'w'
    })
    const exec = createToolExecutor({ readRunner, writeRunner })

    await Promise.all([
      exec.exec('req-1', toolCall('Edit', { file_path: '/1' })),
      exec.exec('req-1', toolCall('Edit', { file_path: '/2' })),
      exec.exec('req-1', toolCall('Edit', { file_path: '/3' })),
    ])

    expect(order).toEqual(['/1', '/2', '/3'])
  })

  it('different reqs do not block each other on writes', async () => {
    const order: string[] = []
    const readRunner = vi.fn(async () => 'r')
    const writeRunner = vi.fn(async (reqId: string, tc: RawToolCall) => {
      order.push(`${reqId}:${(tc.input as { file_path: string }).file_path}`)
    })
    const exec = createToolExecutor({ readRunner, writeRunner })

    await Promise.all([
      exec.exec('req-A', toolCall('Edit', { file_path: '/a1' })),
      exec.exec('req-B', toolCall('Edit', { file_path: '/b1' })),
    ])

    // 两个 req 都跑了,但同一 req 内只有 1 个写,顺序不强求
    expect(order.sort()).toEqual(['req-A:/a1', 'req-B:/b1'])
  })

  it('read tools run in parallel even while a write is in flight', async () => {
    let writeResolve!: () => void
    const writeInFlight = new Promise<void>((resolve) => {
      writeResolve = resolve
    })
    const readRunner = vi.fn(async () => 'r')
    const writeRunner = vi.fn(async () => {
      await writeInFlight
      return 'w'
    })
    const exec = createToolExecutor({ readRunner, writeRunner })

    const writeP = exec.exec('req-1', toolCall('Edit', { file_path: '/x' }))
    // writeRunner 异步触发(.then),等一下
    await vi.waitFor(() => expect(writeRunner).toHaveBeenCalledTimes(1))

    // 此时跑读 —— 不应被写阻塞
    const readP = exec.exec('req-1', toolCall('Read', { file_path: '/y' }))
    expect(readRunner).toHaveBeenCalledTimes(1)
    await expect(readP).resolves.toBe('r')

    writeResolve()
    await expect(writeP).resolves.toBe('w')
  })

  it('propagates runner rejection (write)', async () => {
    const readRunner = vi.fn(async () => 'r')
    const writeRunner = vi.fn(async () => {
      throw new Error('boom')
    })
    const exec = createToolExecutor({ readRunner, writeRunner })

    await expect(exec.exec('req-1', toolCall('Edit', { file_path: '/x' }))).rejects.toThrow(
      'boom',
    )
  })
})