/**
 * AISession 实现 —— ADR-0010 Q2
 *
 * 维护 session state: idle → busy → (done/closed/errored);
 * 把 SDK AsyncIterable<SDKMessage> 转换成 AsyncIterable<AIEvent>;
 * 暴露 send / cancel / close / events() 接口。
 *
 * 设计要点:
 * - **state machine** 严格,转换非法 → throw
 * - **events() 多次调用 → 共享一个内部 fan-out**;每个 consumer 独立 iterator
 * - **send() 立即启动 SDK 进程**,首次 send 触发 spawn (与 ADR-0010 Q3 一致)
 * - **cancel()** 复用内部 AbortController.signal;Q8.2
 * - **close()** 后再 send / cancel / events() → throw
 */

import type {
  AISession as IAISession,
  SessionState,
  ModelSelection,
} from '../providers/AIProvider.js'
import type { AIEvent, DoneReason } from '../providers/AIEvent.js'

/** SDK 适配器接口 —— ClaudeCodeProvider 提供;测试时可注入 mock */
export interface SdkAdapter {
  /** 启动一轮 query,把 SDK 消息流式推给 listener;返回时 turn 结束 */
  runTurn(input: {
    prompt: string
    resume?: string
    signal?: AbortSignal
  }): AsyncIterable<SdkMessageEnvelope>
}

/** 适配器 emit 的统一 envelope(SDK message 的形态提取) */
export type SdkMessageEnvelope =
  | { kind: 'system'; sessionId?: string }
  | { kind: 'partial_assistant'; sessionId?: string; delta?: string; text?: string }
  | { kind: 'assistant'; sessionId?: string; text?: string }
  | {
      kind: 'tool_use'
      sessionId?: string
      thinking?: string
      toolName?: string
      toolInput?: unknown
    }
  | {
      kind: 'tool_result'
      sessionId?: string
      toolName?: string
      toolOutput?: unknown
    }
  | {
      kind: 'result'
      sessionId?: string
      /** 'end_turn' | 'max_tokens' | 'cancelled' */
      reason?: 'end_turn' | 'max_tokens' | 'cancelled'
    }
  | {
      kind: 'error'
      sessionId?: string
      errorCode?: string
      message?: string
      recoverable?: boolean
    }

export interface AiSessionDeps {
  /** Agent 生成的 local_sid —— ADR-0010 Q7.1 */
  id: string
  /** 父需求 id */
  reqId: string
  /** topic / kind —— createSession 透传 */
  topic: string
  kind: 'chat' | 'task'
  /** SDK 适配器 (e.g. ClaudeCodeProvider 提供的) */
  adapter: SdkAdapter
  /** resolve 模型 —— 由 Provider 在 createSession 阶段解析,Q9.1 */
  resolveModel?: () => ModelSelection | undefined
  /** 取消信号 —— 来自外部 AbortController;cancel() 会 abort */
  signal?: AbortSignal
  /** debug 日志开关 */
  debug?: boolean
}

/** events() 中表示「流关闭」的 sentinel —— 与 AIEvent 类型互斥 */
const CLOSE_SENTINEL = Symbol('CLOSE_SENTINEL')

type ConsumerQueue = Array<AIEvent | typeof CLOSE_SENTINEL>

export class AiSession implements IAISession {
  readonly id: string
  readonly reqId: string
  readonly kind: 'chat' | 'task'
  readonly topic: string
  readonly model: ModelSelection | undefined

  #state: SessionState = 'idle'
  /** SDK 返的 session_id —— 首次 query 拿到后缓存,后续 send 可复用 */
  #sdkSessionId: string | undefined
  /** 内部 controller,关闭后 lock 队列 */
  #closed = false
  /** 各 turn 的事件队列 —— events() consumer 各持有一个 consumer queue;pushEvent 时 fan-out */
  #consumers: Array<{ queue: ConsumerQueue; resolve: ((v: IteratorResult<AIEvent>) => void) | null }> = []
  /** 当前正在跑的 turn —— send() 时 set;finish 时清掉 */
  #inflight: Promise<void> | null = null
  /** 内部 cancel controller —— 每轮 send() 重新构造,避免 cancel-after-idle 永久污染 */
  #internalController: AbortController | null = null
  #adapter: SdkAdapter
  #debug: boolean
  /** 是否收到过 cancel() 调用(用于区分用户取消 vs SDK 异常) */
  #cancelled = false

  constructor(deps: AiSessionDeps) {
    this.id = deps.id
    this.reqId = deps.reqId
    this.kind = deps.kind
    this.topic = deps.topic
    this.#adapter = deps.adapter
    this.#debug = deps.debug ?? false
    this.model = deps.resolveModel?.()

    // 不在 constructor 构造 #internalController —— 每次 send() 时 new 一个,
    // 保证 cancel() 只影响当前 turn,不影响后续 turn

    if (this.#debug) {
      console.log(`[AISession ${this.id}] created kind=${this.kind} topic=${this.topic}`)
    }
  }

  get state(): SessionState {
    return this.#state
  }

  get sdkSessionId(): string | undefined {
    return this.#sdkSessionId
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error(`AISession ${this.id} is closed`)
    }
    if (this.#state === 'closed' || this.#state === 'errored') {
      throw new Error(`AISession ${this.id} state=${this.#state}; cannot accept operations`)
    }
  }

  /** 内部 fan-out:把 AIEvent 推给所有 events() consumer */
  #push(ev: AIEvent): void {
    for (const c of this.#consumers) {
      if (c.resolve) {
        const r = c.resolve
        c.resolve = null
        r({ value: ev, done: false })
      } else {
        c.queue.push(ev)
      }
    }
  }

  /** 关闭所有 consumer(close() 时调用) */
  #closeAllConsumers(): void {
    for (const c of this.#consumers) {
      if (c.resolve) {
        const r = c.resolve
        c.resolve = null
        r({ value: undefined, done: true })
      } else {
        c.queue.push(CLOSE_SENTINEL)
      }
    }
    this.#consumers = []
  }

  /** events() —— 返回一个 AsyncIterable,每次迭代拿下一个事件。
   *  多个 consumer 各自有独立 iterator,但共享 fan-out 队列。 */
  events(): AsyncIterable<AIEvent> {
    const session = this
    return {
      [Symbol.asyncIterator]: () => {
        if (session.#closed) {
          // closed session:返回一个空 iterable
          return {
            next: async () => ({ value: undefined, done: true as const }),
            return: async () => ({ value: undefined, done: true as const }),
          }
        }
        const slot = { queue: [] as ConsumerQueue, resolve: null as ((v: IteratorResult<AIEvent>) => void) | null }
        session.#consumers.push(slot)

        const iterator: AsyncIterator<AIEvent> = {
          next: async (): Promise<IteratorResult<AIEvent>> => {
            const head = slot.queue.shift()
            if (head === undefined) {
              // 等下一个事件
              return await new Promise<IteratorResult<AIEvent>>((resolve) => {
                slot.resolve = resolve
              })
            }
            if (head === CLOSE_SENTINEL) {
              return { value: undefined, done: true }
            }
            return { value: head, done: false }
          },
          return: async (): Promise<IteratorResult<AIEvent>> => {
            const idx = session.#consumers.indexOf(slot)
            if (idx >= 0) session.#consumers.splice(idx, 1)
            return { value: undefined, done: true }
          },
          throw: async (err): Promise<IteratorResult<AIEvent>> => {
            const idx = session.#consumers.indexOf(slot)
            if (idx >= 0) session.#consumers.splice(idx, 1)
            throw err
          },
        }
        return iterator
      },
    }
  }

  /** 发送一段用户输入,启动一轮 query */
  async send(text: string, _attachments?: ReadonlyArray<unknown>): Promise<void> {
    this.#assertOpen()
    if (this.#inflight) {
      throw new Error(`AISession ${this.id} is busy; cannot send while a turn is in flight`)
    }
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('send() requires a non-empty text')
    }

    this.#state = 'busy'

    const turn = this.#runTurn(text)
    this.#inflight = turn
    try {
      await turn
    } finally {
      this.#inflight = null
    }
  }

  /** 内部:跑一轮 SDK query,推 AIEvent 给 consumers */
  async #runTurn(text: string): Promise<void> {
    // 每轮 new 一个 controller —— 保证 cancel-after-idle 不污染后续 turn
    const controller = new AbortController()
    this.#internalController = controller
    const signal = controller.signal
    const resume = this.#sdkSessionId // 续上下文

    try {
      const stream = this.#adapter.runTurn({ prompt: text, resume, signal })
      for await (const env of stream) {
        if (env.sessionId) this.#sdkSessionId = env.sessionId
        const events = mapSdkEnvelope(env)
        for (const ev of events) this.#push(ev)
        if (env.kind === 'result' || env.kind === 'error') {
          // result / error 终止;走 state machine
          this.#state = env.kind === 'error' ? 'errored' : 'idle'
          // done 事件已经在 mapSdkEnvelope 推过了
          return
        }
      }
      // 流正常结束但没拿到 result → 视为 end_turn
      this.#push({ type: 'done', reason: 'end_turn', sessionId: this.#sdkSessionId })
      this.#state = 'idle'
    } catch (err) {
      // 区分用户取消 vs SDK 异常:
      // - signal.aborted → 用户主动 cancel(),emit done{reason:'cancelled'}
      // - 其他 → 真正的 SDK 抛错,emit error + done{reason:'error'}
      if (signal.aborted) {
        this.#push({ type: 'done', reason: 'cancelled', sessionId: this.#sdkSessionId })
        this.#state = 'idle'
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      this.#push({ type: 'error', code: 'sdk_throw', message, recoverable: false })
      this.#push({ type: 'done', reason: 'error', sessionId: this.#sdkSessionId })
      this.#state = 'errored'
    } finally {
      // 本轮 controller 退役 —— 下次 send() 时 new 一个干净的
      if (this.#internalController === controller) {
        this.#internalController = null
      }
    }
  }

  /** 取消当前轮 —— 复用 AbortController.signal */
  async cancel(reason?: string): Promise<void> {
    if (this.#closed) return
    if (this.#state !== 'busy') {
      // idle 时 cancel 是 no-op —— 标记 #cancelled 但不 abort(避免污染下次 turn 的 controller)
      this.#cancelled = true
      return
    }
    this.#cancelled = true
    this.#internalController?.abort(reason ?? 'cancelled')
    // 等 in-flight turn 自然退
    if (this.#inflight) {
      try {
        await this.#inflight
      } catch {
        /* 已被 error handler 捕获 */
      }
    }
  }

  /** 关闭 session,释放资源 (state → closed) */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#state === 'busy') {
      this.#internalController?.abort('closed')
      if (this.#inflight) {
        try {
          await this.#inflight
        } catch {
          /* ignore */
        }
      }
    }
    this.#state = 'closed'
    this.#closeAllConsumers()
  }
}

/**
 * 把 SDK adapter 的 envelope 转换成 AIEvent 列表(1 个 envelope 可能产生 0..N 个事件)。
 */
function mapSdkEnvelope(env: SdkMessageEnvelope): AIEvent[] {
  switch (env.kind) {
    case 'system':
      // system 不产生业务事件 —— SDK session_id 通过 envelope.sessionId 上提
      return []
    case 'partial_assistant':
      if (env.delta !== undefined) return [{ type: 'text', text: env.delta, delta: true }]
      if (env.text !== undefined) return [{ type: 'text', text: env.text, delta: false }]
      return []
    case 'assistant':
      return env.text !== undefined ? [{ type: 'text', text: env.text, delta: false }] : []
    case 'tool_use':
      if (env.thinking !== undefined) return [{ type: 'thinking', text: env.thinking }]
      if (env.toolName !== undefined)
        return [{ type: 'tool_use', name: env.toolName, input: env.toolInput ?? null }]
      return []
    case 'tool_result':
      if (env.toolName !== undefined)
        return [{ type: 'tool_result', name: env.toolName, output: env.toolOutput ?? null }]
      return []
    case 'result': {
      const reason: DoneReason = env.reason === 'max_tokens'
        ? 'max_tokens'
        : env.reason === 'cancelled'
          ? 'cancelled'
          : 'end_turn'
      return [{ type: 'done', reason, sessionId: env.sessionId }]
    }
    case 'error':
      return [
        {
          type: 'error',
          code: env.errorCode ?? 'sdk_error',
          message: env.message ?? 'unknown error',
          recoverable: env.recoverable ?? false,
        },
        { type: 'done', reason: 'error', sessionId: env.sessionId },
      ]
  }
}