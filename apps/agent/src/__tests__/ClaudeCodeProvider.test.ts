/**
 * ClaudeCodeProvider tests —— ADR-0010 Q9 wiring
 *
 * 覆盖 createOpts.model → SDK options.model 的透传路径(issue 04 P3 review 漏掉的接线)。
 *
 * 设计:
 * - 注入 mock queryFn 捕获 SDK options
 * - 注入 fake CcSwitchClient 提供可控的 provider 索引
 * - 验证 model id 解析符合 Q9.1:
 *     1. createOpts.model 指定 (providerId, role) → 用该 provider 的 role 对应 model id
 *     2. createOpts.model 未指定 → current provider 的 main model id
 *     3. createOpts.model 指向不存在的 provider → fallback 到 current provider 的 main
 */

import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '../providers/ClaudeCodeProvider.js'
import type { CcSwitchClient, ProviderIndex } from '../providers/CcSwitchClient.js'

function makeFakeCcSwitch(providers: ProviderIndex[]): CcSwitchClient {
  const current = providers.find((p) => p.is_current)
  return {
    getCurrent: () => current,
    getAll: () => providers,
    getById: (id: string) => providers.find((p) => p.id === id),
    getModel: (providerId: string, role) => {
      const p = providers.find((pr) => pr.id === providerId)
      const modelId = p?.models[role]
      if (!p || !modelId) return undefined
      return { providerId, providerName: p.name, role, modelId }
    },
    close: () => {},
  }
}

function makeQueryFn(capture: { options?: Record<string, unknown> }) {
  return ((params: { prompt: string; options?: Record<string, unknown> }) => {
    capture.options = params.options
    return (async function* () {
      yield { type: 'result', subtype: 'success', session_id: 's-1' }
    })()
  }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']
}

const currentProvider: ProviderIndex = {
  id: 'p-current',
  name: 'Current',
  is_current: true,
  baseUrl: '',
  apiKey: '',
  models: {
    main: 'current-main',
    haiku: null,
    sonnet: null,
    opus: null,
    fable: null,
    reasoning: null,
  },
}

const otherProvider: ProviderIndex = {
  id: 'p-other',
  name: 'Other',
  is_current: false,
  baseUrl: '',
  apiKey: '',
  models: {
    main: 'other-main',
    haiku: null,
    sonnet: 'special-sonnet-x',
    opus: null,
    fable: null,
    reasoning: null,
  },
}

describe('createClaudeCodeProvider - Q9 model selection wiring', () => {
  it('uses the (providerId, role) model id when createOpts.model is set', async () => {
    const capture: { options?: Record<string, unknown> } = {}
    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider, otherProvider]),
      queryFn: makeQueryFn(capture),
    })
    const session = await provider.createSession('r-1', {
      topic: 't',
      kind: 'chat',
      model: { providerId: 'p-other', role: 'sonnet' },
    })
    await session.send('hi')

    expect(capture.options?.['model']).toBe('special-sonnet-x')
  })

  it('falls back to current provider main when createOpts.model is undefined', async () => {
    const capture: { options?: Record<string, unknown> } = {}
    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn: makeQueryFn(capture),
    })
    const session = await provider.createSession('r-1', {
      topic: 't',
      kind: 'chat',
    })
    await session.send('hi')

    expect(capture.options?.['model']).toBe('current-main')
  })

  it('falls back to current provider when createOpts.model points to unknown provider', async () => {
    const capture: { options?: Record<string, unknown> } = {}
    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn: makeQueryFn(capture),
    })
    const session = await provider.createSession('r-1', {
      topic: 't',
      kind: 'chat',
      model: { providerId: 'p-unknown', role: 'sonnet' },
    })
    await session.send('hi')

    expect(capture.options?.['model']).toBe('current-main')
  })
})

/* -------------------------------------------------------------------------- *
 * Task 7: SDK envelope mapping (api_retry / assistant error / result usage),
 * localSid/resume/cwd wiring, shared FIFO limiter.
 * -------------------------------------------------------------------------- */

import type { AIEvent } from '../providers/AIEvent.js'

/** 收集一个 session 的 events,直到见到 done —— 与 AISession.test 的模式一致 */
async function collectUntilDone(session: { events(): AsyncIterable<AIEvent> }): Promise<AIEvent[]> {
  const out: AIEvent[] = []
  for await (const ev of session.events()) {
    out.push(ev)
    if (ev.type === 'done') break
  }
  return out
}

describe('createClaudeCodeProvider - Task 7 wiring', () => {
  it('honors localSid, forwards resume/cwd to SDK options, and uses session.id=localSid', async () => {
    const capture: { options?: Record<string, unknown>; calls: number } = { calls: 0 }
    const queryFn = ((params: { options?: Record<string, unknown> }) => {
      capture.calls++
      capture.options = params.options
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'sdk-old',
          usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
        }
      })()
    }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn,
    })
    const session = await provider.createSession('r-1', {
      localSid: 'local-1',
      topic: 't',
      kind: 'chat',
      resume: 'sdk-old',
      cwd: '/workspace/repo',
    })
    expect(session.id).toBe('local-1')

    const eventsP = collectUntilDone(session)
    await session.send('hi')
    const events = await eventsP

    expect(capture.calls).toBe(1)
    expect(capture.options?.['resume']).toBe('sdk-old')
    expect(capture.options?.['cwd']).toBe('/workspace/repo')

    const done = events.find((e) => e.type === 'done')
    expect(done?.type).toBe('done')
    expect(session.sdkSessionId).toBe('sdk-old')
  })

  it('surfaces SDK native api_retry as a single AIEvent.retrying (category A, no extra query)', async () => {
    const capture: { calls: number } = { calls: 0 }
    const queryFn = ((_params: { options?: Record<string, unknown> }) => {
      capture.calls++
      return (async function* () {
        yield {
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 3,
          retry_delay_ms: 1000,
          error_status: 429,
          error: 'rate_limit',
          session_id: 'sdk-1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'sdk-1',
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }
      })()
    }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn,
    })
    const session = await provider.createSession('r-1', { topic: 't', kind: 'chat' })
    const eventsP = collectUntilDone(session)
    await session.send('hi')
    const events = await eventsP

    const retries = events.filter((e) => e.type === 'retrying')
    expect(retries).toHaveLength(1)
    expect(retries[0]).toMatchObject({
      type: 'retrying',
      category: 'A',
      retry: 1,
      maxRetries: 3,
      delayMs: 1000,
    })
    // native retry 是 SDK 内部 HTTP 重试,我们的 queryFn 只被调用一次
    expect(capture.calls).toBe(1)
  })

  it('C1: does NOT surface api_retry with 4xx business error as retrying; classifier routes to B', async () => {
    // api_retry envelope 携带 error_status=401 + error='authentication_failed' 时,
    // 属于 BUSINESS_CODES(等价于 authentication_failed 字面值),不应被 Provider 透传为 retrying。
    // Provider 应让 envelope 经 ErrorClassifier → category 'B' → queryFailed。
    const capture: { calls: number } = { calls: 0 }
    const queryFn = ((_params: { options?: Record<string, unknown> }) => {
      capture.calls++
      return (async function* () {
        // SDK 内部 native retry 时报告的 api_retry:401/business error
        yield {
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 3,
          retry_delay_ms: 1000,
          error_status: 401,
          error: 'authentication_failed',
          session_id: 'sdk-1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'sdk-1',
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }
      })()
    }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn,
    })
    const session = await provider.createSession('r-1', { topic: 't', kind: 'chat' })
    const eventsP = collectUntilDone(session)
    await session.send('hi')
    const events = await eventsP

    const retries = events.filter((e) => e.type === 'retrying')
    expect(retries).toHaveLength(0)
    // Provider 调用仍只 1 次:business error 不进 retry loop
    expect(capture.calls).toBe(1)
  })

  it('C4: when api_retry fixture omits max_retries/retry_delay_ms, retrying envelope surfaces nulls (no 1/3/0 fallback)', async () => {
    const capture: { calls: number } = { calls: 0 }
    const queryFn = ((_params: { options?: Record<string, unknown> }) => {
      capture.calls++
      return (async function* () {
        // 只给 attempt:1,其它字段 SDK 未提供
        yield {
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          error_status: 503,
          error: 'server_error',
          session_id: 'sdk-1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'sdk-1',
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }
      })()
    }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn,
    })
    const session = await provider.createSession('r-1', { topic: 't', kind: 'chat' })
    const eventsP = collectUntilDone(session)
    await session.send('hi')
    const events = await eventsP

    const retries = events.filter((e) => e.type === 'retrying')
    expect(retries).toHaveLength(1)
    expect(retries[0]).toMatchObject({
      type: 'retrying',
      category: 'A',
      retry: 1,
      maxRetries: null,
      delayMs: null,
    })
    expect(capture.calls).toBe(1)
  })

  it('classifies assistant authentication_failed envelope as error category B without retrying', async () => {
    const capture: { calls: number } = { calls: 0 }
    const queryFn = ((_params: { options?: Record<string, unknown> }) => {
      capture.calls++
      return (async function* () {
        yield {
          type: 'assistant',
          error: 'authentication_failed',
          session_id: 'sdk-1',
          message: { content: [] },
        }
      })()
    }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn,
    })
    const session = await provider.createSession('r-1', { topic: 't', kind: 'chat' })
    const eventsP = collectUntilDone(session)
    await session.send('hi')
    const events = await eventsP

    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ type: 'error', code: 'authentication_failed', category: 'B' })
    // B 类不可重试 → queryFn 只调用一次
    expect(capture.calls).toBe(1)
    expect(session.state).toBe('errored')
  })

  it('shares a 5-slot FIFO limiter across 6 concurrent sessions on the same provider', async () => {
    type Gate = { promise: Promise<void>; release: () => void }
    function makeGate(): Gate {
      let release: () => void = () => {}
      const promise = new Promise<void>((r) => { release = r })
      return { promise, release }
    }
    const gates: Gate[] = []
    const queryFn = ((_params: { options?: Record<string, unknown> }) => {
      const gate = makeGate()
      gates.push(gate)
      return (async function* () {
        await gate.promise
        yield { type: 'result', subtype: 'success', session_id: 's-1' }
      })()
    }) as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn,
    })

    const sends: Array<Promise<void>> = []
    for (let i = 0; i < 6; i++) {
      const session = await provider.createSession(`r-${i}`, { topic: `t${i}`, kind: 'chat' })
      sends.push(session.send('hi'))
    }
    // 等 microtask 队列 settle,让 5 个 in-flight + 1 个排队稳定下来
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // 5 个 gate 被占据,第 6 个还没被调用
    expect(gates).toHaveLength(5)

    // 释放第 1 个 gate → breaker 把 slot 交给排队中的第 6 个 session
    gates[0]!.release()
    // 等到第 6 个 session 的 adapter 拿到 breaker slot,创建了它的 gate
    while (gates.length < 6) await new Promise((r) => setImmediate(r))
    expect(gates).toHaveLength(6)

    // 释放剩余 5 个 gate,让所有 in-flight send 完成
    for (let i = 1; i < gates.length; i++) gates[i]!.release()
    await Promise.all(sends)
    await provider.shutdown()
  })
})