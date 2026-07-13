/**
 * AISession tests —— ADR-0010 Q2
 *
 * 覆盖:
 *  - state machine: idle → busy → idle / errored / closed
 *  - events() fan-out: 多个 consumer 共享流
 *  - SDKMessageEnvelope → AIEvent 映射(text / thinking / tool_use / tool_result / result / error)
 *  - send() 串行(in-flight 时再 send → throw)
 *  - cancel() 触发 AbortSignal → 流结束 → done{reason:'cancelled'}
 *  - close() 后再 send / events() → throw
 */

import { describe, it, expect } from 'vitest'
import { AiSession, type SdkAdapter, type SdkMessageEnvelope } from '../session/AISession.js'
import type { AIEvent } from '../providers/AIEvent.js'

/** 一个可手动控制的 adapter factory:yield list 顺序触发 */
function makeAdapter(messages: SdkMessageEnvelope[], opts: { delayMs?: number } = {}): SdkAdapter {
  return {
    async *runTurn(): AsyncIterable<SdkMessageEnvelope> {
      for (const m of messages) {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        yield m
      }
    },
  }
}

async function collectEvents(session: AiSession): Promise<AIEvent[]> {
  const out: AIEvent[] = []
  for await (const ev of session.events()) {
    out.push(ev)
    // events() 是长生命周期流;tests 在看到 done 时主动 break 即可(也方便覆盖多 turn 场景)
    if (ev.type === 'done') break
  }
  return out
}

describe('AiSession', () => {
  it('starts in state=idle', () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([]),
    })
    expect(session.state).toBe('idle')
    expect(session.sdkSessionId).toBeUndefined()
  })

  it('send() → state goes busy → idle after result; events() yields result→done', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'assistant', sessionId: 'sdk-1', text: 'hi' },
        { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' },
      ]),
    })
    const eventsP = collectEvents(session)
    await session.send('hello')
    const events = await eventsP
    expect(events).toEqual([
      { type: 'text', text: 'hi', delta: false },
      { type: 'done', reason: 'end_turn', sessionId: 'sdk-1' },
    ])
    expect(session.state).toBe('idle')
    expect(session.sdkSessionId).toBe('sdk-1')
  })

  it('maps partial_assistant delta into {type:text, delta:true}', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'partial_assistant', sessionId: 's', delta: 'hel' },
        { kind: 'partial_assistant', sessionId: 's', delta: 'lo' },
        { kind: 'result', sessionId: 's', reason: 'end_turn' },
      ]),
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(events).toEqual([
      { type: 'text', text: 'hel', delta: true },
      { type: 'text', text: 'lo', delta: true },
      { type: 'done', reason: 'end_turn', sessionId: 's' },
    ])
  })

  it('maps tool_use and tool_result envelopes', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'tool_use', sessionId: 's', toolName: 'Read', toolInput: { path: '/a' } },
        { kind: 'tool_result', sessionId: 's', toolName: 'Read', toolOutput: { ok: true } },
        { kind: 'result', sessionId: 's', reason: 'end_turn' },
      ]),
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(events).toEqual([
      { type: 'tool_use', name: 'Read', input: { path: '/a' } },
      { type: 'tool_result', name: 'Read', output: { ok: true } },
      { type: 'done', reason: 'end_turn', sessionId: 's' },
    ])
  })

  it('maps thinking envelope', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'tool_use', sessionId: 's', thinking: 'hmm...' },
        { kind: 'result', sessionId: 's', reason: 'end_turn' },
      ]),
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(events[0]).toEqual({ type: 'thinking', text: 'hmm...' })
  })

  it('maps error envelope → error event + done{reason:error}; state→errored', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'error', sessionId: 's', errorCode: 'rate_limit', message: 'slow down', recoverable: true },
      ]),
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(events[0]).toEqual({
      type: 'error',
      code: 'rate_limit',
      message: 'slow down',
      recoverable: true,
    })
    expect(events[1]).toEqual({ type: 'done', reason: 'error', sessionId: 's' })
    expect(session.state).toBe('errored')
  })

  it('multiple events() consumers all receive the same events (fan-out)', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'assistant', sessionId: 's', text: 'a' },
        { kind: 'assistant', sessionId: 's', text: 'b' },
        { kind: 'result', sessionId: 's', reason: 'end_turn' },
      ]),
    })
    const a = collectEvents(session)
    const b = collectEvents(session)
    await session.send('q')
    const [ea, eb] = await Promise.all([a, b])
    expect(ea).toEqual(eb)
    expect(ea).toHaveLength(3)
  })

  it('rejects send() while a turn is in flight', async () => {
    let release: () => void = () => {}
    const blocker = new Promise<void>((r) => (release = r))
    const adapter: SdkAdapter = {
      async *runTurn() {
        await blocker
        yield { kind: 'result', sessionId: 's', reason: 'end_turn' }
      },
    }
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
    })
    const first = session.send('q')
    await expect(session.send('q')).rejects.toThrow(/busy/)
    release()
    await first
  })

  it('cancel() aborts and triggers done{reason:cancelled}', async () => {
    let sawAbort = false
    const adapter: SdkAdapter = {
      // async generator 故意不 yield —— 测试「正在跑但没消息」的 cancel 路径,
      // 等 signal abort 触发 reject 才退出,模拟长跑 turn
      // eslint-disable-next-line require-yield
      async *runTurn({ signal }) {
        // 监听 abort
        if (signal) {
          signal.addEventListener('abort', () => {
            sawAbort = true
          })
        }
        // 不 yield 任何东西,模拟「正在跑」
        await new Promise<void>((resolve, reject) => {
          if (signal) {
            if (signal.aborted) {
              reject(new Error('aborted'))
              return
            }
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }
          // 永不自然 resolve;靠 abort
        })
      },
    }
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
    })
    const eventsP = collectEvents(session)
    const sendP = session.send('q')
    // 给 send() 一点时间进入 runTurn
    await new Promise((r) => setTimeout(r, 5))
    await session.cancel('user')
    await sendP
    const events = await eventsP
    expect(sawAbort).toBe(true)
    // 用户主动 cancel → emit done{reason:'cancelled'},**不是** done{reason:'error'}
    expect(events.at(-1)?.type).toBe('done')
    expect((events.at(-1) as { reason: string }).reason).toBe('cancelled')
  })

  it('idle cancel() is a no-op: next send() works normally', async () => {
    let turn = 0
    const adapter: SdkAdapter = {
      async *runTurn() {
        turn++
        yield { kind: 'assistant', sessionId: 's', text: `t${turn}` }
        yield { kind: 'result', sessionId: 's', reason: 'end_turn' }
      },
    }
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
    })
    // idle 时 cancel —— 不应该污染后续 turn
    await session.cancel('early')
    // 第一轮:并行启动 consumer 和 send
    const events1P = collectEvents(session)
    await session.send('q1')
    const events1 = await events1P
    expect(events1).toContainEqual({ type: 'text', text: 't1', delta: false })
    // 第二轮:如果 idle cancel 污染了 controller,这次会直接 abort 失败
    const events2P = collectEvents(session)
    await session.send('q2')
    const events2 = await events2P
    expect(events2).toContainEqual({ type: 'text', text: 't2', delta: false })
  })

  it('close() stops further send and closes events()', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([]),
    })
    await session.close()
    expect(session.state).toBe('closed')
    await expect(session.send('q')).rejects.toThrow(/closed/)
    // events() on closed session returns empty iterable
    const events = await collectEvents(session)
    expect(events).toHaveLength(0)
  })

  it('preserves sdkSessionId across turns for resume', async () => {
    const captured: { resume?: string } = {}
    const adapter: SdkAdapter = {
      async *runTurn({ resume }) {
        captured.resume = resume
        yield { kind: 'assistant', sessionId: 'sdk-xyz', text: 'turn 1' }
        yield { kind: 'result', sessionId: 'sdk-xyz', reason: 'end_turn' }
      },
    }
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
    })
    // 第一次 send:不传 resume,captured.resume 应为 undefined
    await session.send('q1')
    expect(captured.resume).toBeUndefined()
    expect(session.sdkSessionId).toBe('sdk-xyz')

    // 第二次 send:resume 应当带上 sdk-xyz
    await session.send('q2')
    expect(captured.resume).toBe('sdk-xyz')
  })
})