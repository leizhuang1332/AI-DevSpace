/**
 * 共享 fake AIProvider —— ticket 01 review 后的统一抽象
 *
 * 三个测试文件原本各自实现 ~50 行的 fake provider(subs/queue/pending/closed
 * pub-sub + Symbol.asyncIterator),逻辑相同但语义微差。本文件提取一个共享
 * 工厂,支持两种用法:
 *
 *   1) `createRecordingProvider({ eventsByTurn })` —— 录制 createSession /
 *      send 调用,每个 turn 按 eventsByTurn[turnIndex] 推流。用于 wiring 单测
 *      (analysis-source-refs.test.ts 重写后的 dual-turn 测试)
 *
 *   2) `createSilentProvider({ perTurnEvents })` —— 不录调用,只推固定
 *      events 流 + done。用于 routes-analysis-start.test.ts /
 *      agent-skeleton.e2e.test.ts(只关心 SSE 路径,不在意编排细节)
 *
 *   3) `STUB_PROVIDER` —— createSession 直接抛错(handler 自身不调,仅
 *      满足 AnalysisRoutesOptions 必填字段)。用于 interject / generate-brief
 *      这两个 handler 不调 provider 但 AnalysisRoutes 现在强制要求 provider
 *
 * 设计要点:
 *   - events() 每次调用创建一个新的 sub(避免 turn-2 复用 turn-1 的 closed sub)
 *   - send() 在推完 events 后立即 closeAll + resolve 真 Promise
 *     —— 让 handler 不依赖 timeout 推进;ticket 01 review 后 handler 不再有
 *     1.5s 兜底超时,send() 必须真正 resolve
 */

import type { AIProvider, AISession, CreateSessionOptions } from '../../providers/AIProvider.js'
import type { AIEvent } from '../../providers/AIEvent.js'

interface FakeSub {
  queue: AIEvent[]
  pending: Array<(v: IteratorResult<AIEvent>) => void>
  closed: boolean
}

/** 通用 sub pub-sub 实现 —— 多个 events() 各自独立 sub,send() 广播给全部。 */
function makePubSub() {
  const subs = new Set<FakeSub>()
  return {
    subs,
    newSub(): FakeSub {
      const sub: FakeSub = { queue: [], pending: [], closed: false }
      subs.add(sub)
      return sub
    },
    push(ev: AIEvent): void {
      for (const s of subs) {
        if (s.closed) continue
        const r = s.pending.shift()
        if (r) r({ value: ev, done: false })
        else s.queue.push(ev)
      }
    },
    closeAll(): void {
      for (const s of subs) {
        if (s.closed) continue
        s.closed = true
        while (s.pending.length) s.pending.shift()!({ value: undefined, done: true })
      }
    },
    toAsyncIterable(sub: FakeSub): AsyncIterable<AIEvent> {
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<AIEvent>>((resolve) => {
              const head = sub.queue.shift()
              if (head !== undefined) resolve({ value: head, done: false })
              else if (sub.closed) resolve({ value: undefined, done: true })
              else sub.pending.push(resolve)
            }),
          return: async () => {
            sub.closed = true
            return { value: undefined, done: true }
          },
        }),
      }
    },
  }
}

// ============================================================================
// createRecordingProvider —— 录 createSession/send 调用,用于 wiring 单测
// ============================================================================

export interface RecordingCaptures {
  createSessionCalls: Array<{
    localSid: string
    topic: string
    assemblerKind: 'injected' | 'default'
  }>
  sendCalls: Array<{ text: string; index: number }>
}

export interface RecordingProviderHandle {
  provider: AIProvider
  captures: RecordingCaptures
}

export function createRecordingProvider(opts: {
  /** 每个 turn 要推的 events;turnIndex 递增取数组;缺位默认推 done。 */
  eventsByTurn: AIEvent[][]
} = { eventsByTurn: [] }): RecordingProviderHandle {
  const captures: RecordingCaptures = {
    createSessionCalls: [],
    sendCalls: [],
  }
  let turnIndex = 0

  const provider: AIProvider = {
    name: 'fake-recording',
    async createSession(reqId, o: CreateSessionOptions): Promise<AISession> {
      const localSid = o.localSid ?? `auto-${captures.createSessionCalls.length}`
      captures.createSessionCalls.push({
        localSid,
        topic: o.topic,
        assemblerKind: o.assembler ? 'injected' : 'default',
      })
      const pubsub = makePubSub()

      const session: AISession = {
        id: localSid,
        reqId,
        kind: o.kind,
        topic: o.topic,
        state: 'idle',
        sdkSessionId: 'rec-sdk',
        model: undefined,
        events: () => pubsub.toAsyncIterable(pubsub.newSub()),
        async send(text: string) {
          captures.sendCalls.push({ text, index: turnIndex })
          const events = opts.eventsByTurn[turnIndex] ?? [
            { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-sdk' },
          ]
          turnIndex++
          for (const ev of events) pubsub.push(ev)
          // closeAll 只在 events 全部被消费者 drain 后才发生 —— 等下一个
          // microtask 跑完所有 pending resolvers 才 close。
          // 真实 SDK 的 send() await SDK 流关闭才 resolve,这里用 queueMicrotask
          // 让 inner iterator 先消化 events 再 close。
          await new Promise<void>((r) => { queueMicrotask(r) })
          pubsub.closeAll()
        },
        async cancel() { pubsub.closeAll() },
        async close() { pubsub.closeAll() },
      }
      return session
    },
    async shutdown() {},
  }
  return { provider, captures }
}

// ============================================================================
// createSilentProvider —— 不录调用,每个 turn 推固定 events,用于 SSE / jsonl 路径测试
// ============================================================================

export interface SilentProviderHandle {
  provider: AIProvider
}

export function createSilentProvider(opts: {
  /** 每个 turn 推同一份 events;缺省推 1 条 text + done。 */
  perTurnEvents?: AIEvent[]
} = {}): SilentProviderHandle {
  const perTurnEvents = opts.perTurnEvents ?? [
    { type: 'text', text: 'fake output', delta: false },
    { type: 'done', reason: 'end_turn' as const, sessionId: 'silent-sdk' },
  ]

  const provider: AIProvider = {
    name: 'fake-silent',
    async createSession(_reqId, o: CreateSessionOptions): Promise<AISession> {
      const pubsub = makePubSub()
      const session: AISession = {
        id: o.localSid ?? 'silent-sid',
        reqId: _reqId,
        kind: o.kind,
        topic: o.topic,
        state: 'idle',
        sdkSessionId: 'silent-sdk',
        model: undefined,
        events: () => pubsub.toAsyncIterable(pubsub.newSub()),
        async send() {
          for (const ev of perTurnEvents) pubsub.push(ev)
          pubsub.closeAll()
        },
        async cancel() { pubsub.closeAll() },
        async close() { pubsub.closeAll() },
      }
      return session
    },
    async shutdown() {},
  }
  return { provider }
}

// ============================================================================
// STUB_PROVIDER —— 仅满足 AnalysisRoutesOptions 必填字段;handler 自身不调
// ============================================================================

export const STUB_PROVIDER: AIProvider = {
  name: 'stub',
  async createSession(): Promise<AISession> {
    throw new Error('STUB_PROVIDER: handler should not invoke this path')
  },
  async shutdown() {},
}