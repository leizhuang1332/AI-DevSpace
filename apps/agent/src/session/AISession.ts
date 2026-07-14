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
import type { ProviderSemaphore } from '../error/ProviderSemaphore.js'
import { executeWithRetry, RetryFailure } from '../error/RetryStrategy.js'
import { classifyError } from '../error/ErrorClassifier.js'
import type { SessionQueryLogInput, SessionLogger } from '../log/SessionLogger.js'
import type { GlobalLogger } from '../log/GlobalLogger.js'
import type { SystemPromptAssembler, AssemblerRequirement } from '../prompt/SystemPromptAssembler.js'

export interface SdkUsage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}

/** SDK 适配器接口 —— ClaudeCodeProvider 提供;测试时可注入 mock */
export interface SdkAdapter {
  /**
   * 启动一轮 query,把 SDK 消息流式推给 listener;返回时 turn 结束。
   *
   * - `prompt`: 用户输入文本
   * - `resume`: SDK session_id(Q3:续上下文)
   * - `appendSystemPrompt`: 由 SystemPromptAssembler 计算的 per-query system prompt 增量
   *   (Q5.1:SDK 接受 `appendSystemPrompt`,我们追加到 Claude Code 默认 system prompt 之后)
   * - `signal`: AbortController.signal(用于 cancel)
   */
  runTurn(input: {
    prompt: string
    resume?: string
    appendSystemPrompt?: string
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
      /** Token usage summary from SDK result */
      usage?: SdkUsage
    }
  | {
      /** SDK 内部 HTTP 层 api_retry 透传:Native retry,不在 AISession retry loop 中,
       *  仅作 AIEvent.retrying 投递(供 UI/日志观测);不触发新一轮 query。
       *  C4:retry/maxRetries/delayMs 在 SDK 未提供时为 null(spec 透明)。 */
      kind: 'retrying'
      sessionId?: string
      category: 'A' | 'C' | 'D'
      retry: number | null
      maxRetries: number | null
      delayMs: number | null
    }
  | {
      kind: 'error'
      sessionId?: string
      errorCode?: string
      message?: string
      /** HTTP status (for transport-level error classification) */
      status?: number
      /** Underlying cause (kept as unknown so adapters can attach SDK detail) */
      error?: unknown
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
  /** 系统 prompt 装配器(Q5)—— 注入后每次 send() 自动拼装 */
  assembler?: SystemPromptAssembler
  /** 当前 requirement 上下文(Q5 assembleDynamic 需要) */
  requirement?: AssemblerRequirement
  /** SDK 初始 session id —— 用于断点续传,首次 send() 时使用 */
  initialSdkSessionId?: string
  /** Provider 共享的 FIFO 限流器 —— 注入后每轮 send() 走 semaphore.run() */
  providerSemaphore?: ProviderSemaphore
  /** 重试 sleep 钩子 —— 测试可注入,默认走 abortableSleep */
  retrySleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Session-level query 日志 —— 每次 send() 结束后调用一次 */
  sessionLogger?: SessionLogger
  /** 用户取消(队列中或运行中)的回调 —— 供上层清理 resume / 释放资源 */
  onCancelled?: (context: { localSid: string; reqId: string; reason: string }) => void | Promise<void>
  /** 时钟注入 —— 便于测试,默认 Date.now() */
  nowMs?: () => number
  /** 全局结构化日志 —— retryExhausted / queryFailed 调用 */
  globalLogger?: GlobalLogger
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
  /** Q5:per-session 系统 prompt 装配器 */
  #assembler: SystemPromptAssembler | undefined
  /** Q5:requirement 上下文 */
  #requirement: AssemblerRequirement | undefined
  /** 外部 signal —— 通常是上层注入的 AbortController.signal */
  #externalSignal: AbortSignal | undefined
  /** Provider 共享的 FIFO 限流器 */
  #providerSemaphore: ProviderSemaphore | undefined
  /** 重试 sleep 钩子 */
  #retrySleep: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined
  /** Session-level query 日志 */
  #sessionLogger: SessionLogger | undefined
  /** 用户取消回调 */
  #onCancelled: ((context: { localSid: string; reqId: string; reason: string }) => void | Promise<void>) | undefined
  /** 时钟注入 */
  #nowMs: () => number
  /** 全局结构化日志 */
  #globalLogger: GlobalLogger | undefined

  constructor(deps: AiSessionDeps) {
    this.id = deps.id
    this.reqId = deps.reqId
    this.kind = deps.kind
    this.topic = deps.topic
    this.#adapter = deps.adapter
    this.#debug = deps.debug ?? false
    this.#assembler = deps.assembler
    this.#requirement = deps.requirement
    this.#externalSignal = deps.signal
    this.#providerSemaphore = deps.providerSemaphore
    this.#retrySleep = deps.retrySleep
    this.#sessionLogger = deps.sessionLogger
    this.#onCancelled = deps.onCancelled
    this.#nowMs = deps.nowMs ?? (() => Date.now())
    this.#globalLogger = deps.globalLogger
    // 初始 SDK session id —— 用于断点续传
    this.#sdkSessionId = deps.initialSdkSessionId
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
    return {
      [Symbol.asyncIterator]: () => {
        if (this.#closed) {
          // closed session:返回一个空 iterable
          return {
            next: async () => ({ value: undefined, done: true as const }),
            return: async () => ({ value: undefined, done: true as const }),
          }
        }
        const slot = { queue: [] as ConsumerQueue, resolve: null as ((v: IteratorResult<AIEvent>) => void) | null }
        this.#consumers.push(slot)

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
            const idx = this.#consumers.indexOf(slot)
            if (idx >= 0) this.#consumers.splice(idx, 1)
            return { value: undefined, done: true }
          },
          throw: async (err): Promise<IteratorResult<AIEvent>> => {
            const idx = this.#consumers.indexOf(slot)
            if (idx >= 0) this.#consumers.splice(idx, 1)
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
    // 联动外部 signal:外部 abort 时也带过来
    const abortFromExternal = (): void => {
      controller.abort(this.#externalSignal?.reason)
    }
    if (this.#externalSignal?.aborted) abortFromExternal()
    else this.#externalSignal?.addEventListener('abort', abortFromExternal, { once: true })

    // Q5 装配:base(per-session 缓存) + dynamic(per-query)
    let appendSystemPrompt: string | undefined
    if (this.#assembler) {
      try {
        const base = await this.#assembler.assembleBase({
          id: this.id,
          reqId: this.reqId,
          kind: this.kind,
          topic: this.topic,
        })
        const dynamic = await this.#assembler.assembleDynamic({
          query: text,
          session: {
            id: this.id,
            reqId: this.reqId,
            kind: this.kind,
            topic: this.topic,
          },
          req:
            this.#requirement
            ?? { reqId: this.reqId, rootPath: process.cwd() },
        })
        appendSystemPrompt = `${base}\n\n${dynamic}`
      } catch (err) {
        // 装配失败 → 不阻断 turn,降级为不加 system prompt(SDK 默认也能跑)
        if (this.#debug) {
          console.warn(`[AISession ${this.id}] system prompt assembly failed:`, err)
        }
      }
    }

    const startedAt = this.#nowMs()
    let outputText = ''
    let sawOutputWithoutResume = false
    let attempts = 1
    let retryDelaysMs: number[] = []
    let usage: SdkUsage | null = null
    let status: SessionQueryLogInput['status'] = 'succeeded'
    let finalError: SessionQueryLogInput['error'] = null

    const execute = async (): Promise<void> => {
      const result = await executeWithRetry(
        async () => await this.#runAttempt({
          text,
          appendSystemPrompt,
          signal,
          onText: (chunk) => { outputText += chunk },
          // C3:只要 emit 过 text 就置 true —— resume 续上下文时若已发出 partial output,
          // 后续 transient 错误也必须拒绝 retry(避免用户看到 partial 后又突然整体重发)。
          markOutput: () => { sawOutputWithoutResume = true },
        }),
        {
          signal,
          sleep: this.#retrySleep,
          canRetry: (error) => {
            if (sawOutputWithoutResume) return false
            // SDK 主动报 error envelope 是 deterministic,不参与 retry
            if (error && typeof error === 'object' && (error as { __sdkError?: boolean }).__sdkError) return false
            return true
          },
          onRetry: async ({ classification, retry, maxRetries, delayMs }) => {
            // retrying 只对 A/C/D 分类发出(B/E/cancelled 不会进入此分支)
            const cat = classification.category
            if (cat !== 'A' && cat !== 'C' && cat !== 'D') return
            this.#push({
              type: 'retrying',
              category: cat,
              retry,
              maxRetries,
              delayMs,
              message: '连接异常,正在重试',
            })
          },
        },
      )
      attempts = result.attempts
      retryDelaysMs = result.retryDelaysMs
      usage = result.value.usage
      if (result.value.reason === 'cancelled') {
        status = 'cancelled'
        await this.#onCancelled?.({
          localSid: this.id,
          reqId: this.reqId,
          reason: String(signal.reason ?? 'cancelled'),
        })
      }
    }

    try {
      if (this.#providerSemaphore) await this.#providerSemaphore.run(execute, signal)
      else await execute()
      this.#state = 'idle'
    } catch (error) {
      const failure = error instanceof RetryFailure
        ? error
        : new RetryFailure(classifyError(error, signal), attempts, retryDelaysMs)
      attempts = failure.attempts
      retryDelaysMs = failure.retryDelaysMs
      // 死代码移除:envelope 错误已经是 deterministic 终态,recoverable 永远是 false
      // (RetryFailure 抛出后 AISession 不会重试),不再从 original 中读 recoverable
      if (failure.classification.category === 'cancelled' || signal.aborted) {
        status = 'cancelled'
        this.#push({ type: 'done', reason: 'cancelled', sessionId: this.#sdkSessionId })
        this.#state = 'idle'
        await this.#onCancelled?.({
          localSid: this.id,
          reqId: this.reqId,
          reason: String(signal.reason ?? 'cancelled'),
        })
      } else {
        status = failure.classification.category === 'E' ? 'business_error' : 'failed'
        finalError = {
          category: failure.classification.category,
          code: failure.classification.code,
          message: failure.classification.message,
        }
        if (failure.classification.category !== 'E') {
          const context = {
            reqId: this.reqId,
            sessionId: this.id,
            category: failure.classification.category,
            code: failure.classification.code,
            attempts: failure.attempts,
          }
          if (failure.classification.retryable) this.#globalLogger?.retryExhausted(context)
          else this.#globalLogger?.queryFailed(context)
        }
        this.#push({
          type: 'error',
          code: finalError.code,
          message: finalError.message,
          // envelope 错误是 deterministic 终态 —— recoverable 显式 false,不再透传 SDK 的标记
          recoverable: false,
          category: finalError.category,
        })
        this.#push({ type: 'done', reason: 'error', sessionId: this.#sdkSessionId })
        this.#state = failure.classification.category === 'E' ? 'idle' : 'errored'
      }
    } finally {
      // 清理外部 signal listener
      this.#externalSignal?.removeEventListener('abort', abortFromExternal)
      // 本轮 controller 退役 —— 下次 send() 时 new 一个干净的
      if (this.#internalController === controller) {
        this.#internalController = null
      }
      await this.#sessionLogger?.logQuery({
        localSid: this.id,
        reqId: this.reqId,
        durationMs: this.#nowMs() - startedAt,
        attempts,
        retryDelaysMs,
        status,
        inputText: text,
        outputText,
        incomplete: status !== 'succeeded',
        tokens: usage,
        error: finalError,
      })
    }
  }

  /** 单次 attempt:跑一次 SDK stream;遇到 error envelope 时抛出可分类对象 */
  async #runAttempt(input: {
    text: string
    appendSystemPrompt: string | undefined
    signal: AbortSignal
    onText: (text: string) => void
    markOutput: () => void
  }): Promise<{ reason: DoneReason; usage: SdkUsage | null }> {
    const stream = this.#adapter.runTurn({
      prompt: input.text,
      resume: this.#sdkSessionId,
      signal: input.signal,
      appendSystemPrompt: input.appendSystemPrompt,
    })
    for await (const env of stream) {
      if (env.sessionId) this.#sdkSessionId = env.sessionId
      if (env.kind === 'error') {
        // 标记为 deterministic SDK error envelope —— 不参与 retry(分类器可能误判为 transient)
        throw {
          __sdkError: true,
          code: env.errorCode ?? 'sdk_error',
          status: env.status,
          message: env.message ?? 'unknown error',
          cause: env.error,
          recoverable: env.recoverable,
        }
      }
      const events = mapSdkEnvelope(env)
      for (const event of events) {
        if (event.type === 'text') {
          input.onText(event.text)
          input.markOutput()
        }
        this.#push(event)
      }
      if (env.kind === 'result') {
        const reason: DoneReason = env.reason === 'max_tokens'
          ? 'max_tokens'
          : env.reason === 'cancelled'
            ? 'cancelled'
            : 'end_turn'
        return { reason, usage: env.usage ?? null }
      }
    }
    this.#push({ type: 'done', reason: 'end_turn', sessionId: this.#sdkSessionId })
    return { reason: 'end_turn', usage: null }
  }

  /** 取消当前轮 —— 复用 AbortController.signal */
  async cancel(reason?: string): Promise<void> {
    if (this.#closed) return
    if (this.#state !== 'busy') {
      // idle 时 cancel 是 no-op —— 不 abort(避免污染下次 turn 的 controller,
      // 每轮 send() 会 new 一个干净的 AbortController)
      return
    }
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
      // envelope error 已经是 deterministic 终态(recoverable 永远 false),
      // 显式赋值便于读代码者理解
      return [
        {
          type: 'error',
          code: env.errorCode ?? 'sdk_error',
          message: env.message ?? 'unknown error',
          recoverable: false,
        },
        { type: 'done', reason: 'error', sessionId: env.sessionId },
      ]
    case 'retrying':
      return [
        {
          type: 'retrying',
          category: env.category,
          retry: env.retry,
          maxRetries: env.maxRetries,
          delayMs: env.delayMs,
          message: 'SDK native retry',
        },
      ]
  }
}