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

import { describe, it, expect, vi } from 'vitest'
import { AiSession, type SdkAdapter, type SdkMessageEnvelope } from '../session/AISession.js'
import type { AIEvent } from '../providers/AIEvent.js'
import { ProviderSemaphore } from '../error/ProviderSemaphore.js'
import type { SessionLogger } from '../log/SessionLogger.js'
import type { SessionStore, SessionMeta } from '../session/SessionStore.js'

/** Deferred helper —— for limiting / abort testing */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

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
    // 死代码清理后:envelope error → recoverable 永远 false(不再透传 SDK 的 recoverable 标记)
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([
        { kind: 'error', sessionId: 's', errorCode: 'rate_limit', message: 'slow down' },
      ]),
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(events[0]).toMatchObject({
      type: 'error',
      code: 'rate_limit',
      message: 'slow down',
      recoverable: false,
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


  // ---- Task 6: 初始 resume / 重试 / 取消 / 日志 / 限流 协同 ----

  it('uses initialSdkSessionId on the first turn', async () => {
    const resumes: Array<string | undefined> = []
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      initialSdkSessionId: 'sdk-old',
      adapter: {
        async *runTurn({ resume }) {
          resumes.push(resume)
          yield { kind: 'result', sessionId: resume, reason: 'end_turn' }
        },
      },
    })
    await session.send('q')
    expect(resumes).toEqual(['sdk-old'])
  })

  it('retries transient throws and emits retrying before success', async () => {
    let calls = 0
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      retrySleep: async () => {},
      adapter: {
        async *runTurn() {
          calls++
          if (calls < 3) throw { status: 429, message: 'slow down' }
          yield { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' }
        },
      },
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    const retries = events.filter((event) => event.type === 'retrying')
    expect(retries).toHaveLength(2)
    expect(retries[0]).toMatchObject({ category: 'A', retry: 1, delayMs: 1000 })
    expect(retries[1]).toMatchObject({ category: 'A', retry: 2, delayMs: 3000 })
    expect(session.state).toBe('idle')
  })

  it('C3: does not retry transient throws after partial output on a resumed session', async () => {
    // resume 续上下文:即使 #sdkSessionId 已有值,只要 emit 过 text,就视为
    // 「用户已看到 partial output」,再抛 transient 也必须不再 retry。
    let calls = 0
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      initialSdkSessionId: 'sdk-old',
      retrySleep: async () => {},
      adapter: {
        async *runTurn() {
          calls++
          // 第一轮:yield 一段 partial text(模拟 SDK 在 resume 续上下文时已输出)
          yield { kind: 'partial_assistant', sessionId: 'sdk-old', delta: 'partial...' }
          // 然后 throw transient → AISession 拿到 {status:429}
          // 旧实现:`!this.#sdkSessionId` 为 false → sawOutputWithoutResume 永远是 false → 会 retry
          // 新实现:只要 emit 过 text 就 set sawOutputWithoutResume=true → canRetry 拒绝
          throw { status: 429, message: 'slow down' }
        },
      },
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    await eventsP
    expect(calls).toBe(1)
  })

  it('does not retry auth failures and moves to errored', async () => {
    let calls = 0
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      retrySleep: async () => {},
      adapter: {
        // eslint-disable-next-line require-yield
        async *runTurn() {
          calls++
          throw { status: 401, message: 'invalid api key' }
        },
      },
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(calls).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', category: 'B' }))
    expect(session.state).toBe('errored')
  })

  it('keeps the session idle after an E business error', async () => {
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter: makeAdapter([{ kind: 'error', errorCode: 'error_max_turns', message: 'max turns' }]),
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    const events = await eventsP
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', category: 'E' }))
    expect(session.state).toBe('idle')
  })

  it('aborts a queued turn and invokes onCancelled without retrying', async () => {
    const semaphore = new ProviderSemaphore({ limit: 1 })
    const blocker = deferred()
    const first = semaphore.run(async () => { await blocker.promise })
    const onCancelled = vi.fn(async () => {})
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      providerSemaphore: semaphore,
      onCancelled,
      adapter: makeAdapter([{ kind: 'result', reason: 'end_turn' }]),
    })
    const eventsP = collectEvents(session)
    const sendP = session.send('q')
    await Promise.resolve()
    await session.cancel('user')
    await sendP
    const events = await eventsP
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'cancelled' })
    expect(onCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ localSid: 's-1', reason: 'user' }),
    )
    blocker.resolve()
    await first
  })

  it('writes one query summary after completion', async () => {
    const logQuery = vi.fn(async () => {})
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      sessionLogger: { logQuery } as unknown as SessionLogger,
      nowMs: (() => { let n = 0; return () => n++ === 0 ? 100 : 150 })(),
      adapter: makeAdapter([
        { kind: 'assistant', text: 'answer', sessionId: 'sdk-1' },
        {
          kind: 'result',
          reason: 'end_turn',
          sessionId: 'sdk-1',
          usage: { input: 3, output: 2, cacheRead: 1, cacheCreation: 0 },
        },
      ]),
    })
    await session.send('question')
    expect(logQuery).toHaveBeenCalledWith(expect.objectContaining({
      localSid: 's-1',
      reqId: 'r-1',
      attempts: 1,
      inputText: 'question',
      outputText: 'answer',
      status: 'succeeded',
      durationMs: 50,
    }))
  })
})

describe('AISession · last_input persistence', () => {
  it('writes inputText to meta.yaml via sessionStore after successful send', async () => {
    const updateSession = vi.fn(async (sid: string, patch: Partial<SessionMeta>) =>
      ({
        sid,
        reqId: 'r-1',
        provider: 'claude-code',
        sdkSessionId: '',
        created_at: '',
        last_active_at: '',
        topic: 't',
        kind: 'chat',
        ...patch,
      }) satisfies SessionMeta,
    )
    const sessionStore = { updateSession } as unknown as SessionStore
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      sessionStore,
      adapter: makeAdapter([
        { kind: 'assistant', text: 'ok', sessionId: 'sdk-1' },
        { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' },
      ]),
    })
    await session.send('hello world')
    expect(updateSession).toHaveBeenCalledWith('s-1', expect.objectContaining({ last_input: 'hello world' }))
  })
})

describe('AISession · isRetry', () => {
  it('passes initialDelayMs=0 to retrySleep when isRetry=true and first attempt fails', async () => {
    const sleeps: number[] = []
    const retrySleep = vi.fn(async (ms: number) => { sleeps.push(ms) })
    let calls = 0
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      retrySleep,
      adapter: {
        // eslint-disable-next-line require-yield
        async *runTurn() {
          calls++
          if (calls < 2) throw { status: 429, type: 'rate_limit_error', message: 'slow down' }
          yield { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' }
        },
      },
    })
    const eventsP = collectEvents(session)
    await session.send('q', { isRetry: true })
    await eventsP
    expect(sleeps[0]).toBe(0)
  })

  it('passes initialDelayMs=1000 by default when isRetry omitted', async () => {
    const sleeps: number[] = []
    const retrySleep = vi.fn(async (ms: number) => { sleeps.push(ms) })
    let calls = 0
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      retrySleep,
      adapter: {
        // eslint-disable-next-line require-yield
        async *runTurn() {
          calls++
          if (calls < 2) throw { status: 429, type: 'rate_limit_error', message: 'slow down' }
          yield { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' }
        },
      },
    })
    const eventsP = collectEvents(session)
    await session.send('q')
    await eventsP
    expect(sleeps[0]).toBe(1000)
  })
})