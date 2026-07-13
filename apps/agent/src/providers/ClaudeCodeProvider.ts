/**
 * ClaudeCodeProvider —— @anthropic-ai/claude-agent-sdk 实现
 *
 * 包装 query() 函数;createSession() 返回 AISession 实例。
 * 实际 spawn 由首次 send() 触发(ADR-0010 Q3:每 query 瞬时 spawn)。
 *
 * 设计要点:
 * - **model 解析走 CcSwitchClient** —— Q9.1 (providerId, role) → model id
 * - **resume 由 AISession 内部维护** —— SDK session_id 缓存 + 下次透传
 * - **SdkAdapter 注入** —— 让 AISession 不直接依赖 SDK,便于测试时 mock
 * - **共享 FIFO limiter** —— Task 3/7:同 Provider 创建的所有 session 走同一 5-slot queue,
 *   防止 SDK 子进程 / 上游 API 同时并发超过限额
 * - **Native api_retry 还原** —— SDK 内部 HTTP 层重试的 system 事件,以
 *   envelope(retrying) → AIEvent.retrying 单向透传;不进入 AISession 的 retry loop
 * - **shutdown 顺序** —— 先 circuitBreaker.close()(拒绝所有队列中的 waiter),
 *   再清 queryFn 缓存(已经走完的 query 自然退出)
 */

import { randomUUID } from 'node:crypto'
import { AiSession } from '../session/AISession.js'
import type { SdkAdapter, SdkMessageEnvelope, SdkUsage } from '../session/AISession.js'
import type {
  AIProvider,
  AISession as IAISession,
  CreateSessionOptions,
  ModelSelection,
} from './AIProvider.js'
import type { CcSwitchClient, ModelRole, ProviderIndex } from './CcSwitchClient.js'
import type { PermissionHook } from '../tools/PermissionHook.js'
import type {
  SystemPromptAssembler,
  AssemblerRequirement,
} from '../prompt/SystemPromptAssembler.js'
import type { CircuitBreaker } from '../error/CircuitBreaker.js'
import { CircuitBreaker as DefaultCircuitBreaker } from '../error/CircuitBreaker.js'
import type { SessionLogger } from '../log/SessionLogger.js'
import type { GlobalLogger } from '../log/GlobalLogger.js'

/** SDK query 函数的类型 —— 用 type-only import 避免运行时依赖倒置 */
type QueryFn = (params: {
  prompt: string
  options?: Record<string, unknown>
}) => AsyncIterable<unknown>

/** Task 7:abort-aware sleep —— 测试可注入 fake,默认 0(让原生 setTimeout 处理) */
export type RetrySleep = (ms: number, signal?: AbortSignal) => Promise<void>

/** 用户取消(队列中或运行中)回调 —— 供上层清理 resume / 释放资源 */
export type OnSessionCancelled = (context: {
  localSid: string
  reqId: string
  reason: string
}) => void | Promise<void>

export interface ClaudeCodeProviderOptions {
  /** cc-switch client —— Q9 */
  ccSwitch: CcSwitchClient
  /** SDK query 函数 —— 测试时可注入 mock;默认用 @anthropic-ai/claude-agent-sdk */
  queryFn?: QueryFn
  /** debug log */
  debug?: boolean
  /** Q6:5 类高危 PreToolUse hook —— 注入后 Provider 在 adapter 里 wire 到 SDK options.hooks */
  permissionHook?: PermissionHook
  /** Q5:system prompt 装配器 —— Provider 注入到新建的 AiSession,使其在每次 send() 自动装配 */
  assembler?: SystemPromptAssembler
  /** Task 3:Provider 共享 FIFO limiter(默认 5 slots);null 表示不限制 */
  circuitBreaker?: CircuitBreaker | null
  /** Task 5:retry sleep 钩子(测试可注入) */
  retrySleep?: RetrySleep
  /** Task 4:session 级 query 日志 */
  sessionLogger?: SessionLogger
  /** Task 4:用户取消回调 */
  onSessionCancelled?: OnSessionCancelled
  /** Task 4:全局结构化日志 */
  globalLogger?: GlobalLogger
}

/** 工具:从 record 中提 number;缺失 / 非 number → null */
function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 工具:record 类型守卫 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 从 SDK 的原始 message 提 SdkMessageEnvelope。
 *
 * 关注:
 *   - system(api_retry) → retrying envelope(SDK 内部 HTTP 重试,仅供 UI 观测)
 *   - system(其它) → system envelope(session_id 上提)
 *   - assistant(error=...) → error envelope(SDK 0.3.206 声明 SDKAssistantMessageError)
 *   - assistant(正常 text) → assistant envelope
 *   - result(success) → result envelope + usage 字段
 *   - result(error_*) → error envelope(分类器分到 E)
 * 其余 system 子类 / tool_use / tool_result 在本期先不细拆(P2/P4 才做)。
 */
function toEnvelope(raw: unknown): SdkMessageEnvelope | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const type = m['type']
  // session_id 可能在顶层或在 message.session_id
  const sessionId =
    (typeof m['session_id'] === 'string' ? (m['session_id'] as string) : undefined) ??
    ((m['message'] as Record<string, unknown> | undefined)?.['session_id'] as string | undefined)

  switch (type) {
    case 'system': {
      // system + subtype=api_retry → 还原 native retry envelope
      // (C1:business 错误 + 4xx → 改为 error envelope,让 AISession 的 ErrorClassifier 归 B)
      if (m['subtype'] === 'api_retry') {
        const errorStatus = m['error_status']
        const errorString = typeof m['error'] === 'string' ? (m['error'] as string) : undefined
        // C1:business 错误(认证/权限/账单/请求无效/模型未找到)—— 4xx 时不让 Provider
        // 透传成 retrying envelope(AISession 会把它当 transient 透传到 UI),
        // 而是转成 error envelope,让 AISession → ErrorClassifier → category 'B' →
        // queryFailed 终态失败。
        const BUSINESS_API_RETRY_CODES = new Set([
          'authentication_failed',
          'permission_denied',
          'billing_error',
          'invalid_request',
          'model_not_found',
          'error_max_turns',
          'error_max_budget_usd',
          'error_max_structured_output_retries',
          'agent_abandoned',
          'agent_gave_up',
        ])
        const isBusinessCode =
          errorString !== undefined && BUSINESS_API_RETRY_CODES.has(errorString)
        const is4xx =
          typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 500
        if (isBusinessCode && is4xx) {
          // 业务 4xx → 转 error envelope,让 classifier 归 B
          return {
            kind: 'error',
            sessionId,
            errorCode: errorString!,
            message: errorString!,
            status: errorStatus,
            error: m,
          }
        }
        // 否则按 error_status 走 category:
        //   >=500 或 408/429 → A(transient)
        //   其它 4xx / 缺失 → D(transport)
        const category: 'A' | 'D' =
          typeof errorStatus === 'number'
            ? (errorStatus >= 500 || errorStatus === 408 || errorStatus === 429 ? 'A' : 'D')
            : 'D'
        // C4:retry/maxRetries/delayMs SDK 未提供时为 null(spec 透明),不再补 1/3/0
        return {
          kind: 'retrying',
          sessionId,
          category,
          retry: numberOrNull(m['attempt']),
          maxRetries: numberOrNull(m['max_retries']),
          delayMs: numberOrNull(m['retry_delay_ms']),
        }
      }
      return { kind: 'system', sessionId }
    }
    case 'assistant': {
      // SDK 0.3.206 声明 SDKAssistantMessageError:assistant message 顶层带 error 字段
      // (e.g. 'authentication_failed', 'billing_error', 'rate_limit', 'overloaded', 'server_error')
      const assistantError = typeof m['error'] === 'string' ? (m['error'] as string) : undefined
      if (assistantError) {
        return {
          kind: 'error',
          sessionId,
          errorCode: assistantError,
          message: assistantError,
          error: m,
        }
      }
      // message.content 是 [{type:'text', text:string}, ...]
      const message = m['message'] as { content?: unknown } | undefined
      const content = message?.content
      if (!Array.isArray(content)) return null
      const textParts: string[] = []
      for (const block of content) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            textParts.push(b['text'] as string)
          }
        }
      }
      return {
        kind: 'assistant',
        sessionId,
        text: textParts.join(''),
      }
    }
    case 'result': {
      // subtype: 'success' | 'error_max_turns' | 'error_max_budget_usd' |
      //          'error_max_structured_output_retries' | 'error_during_execution' | ...
      const subtype = m['subtype'] as string | undefined
      const usageRecord = isRecord(m['usage']) ? m['usage'] : {}
      const usage: SdkUsage = {
        input: numberOrNull(usageRecord['input_tokens']),
        output: numberOrNull(usageRecord['output_tokens']),
        cacheRead: numberOrNull(usageRecord['cache_read_input_tokens']),
        cacheCreation: numberOrNull(usageRecord['cache_creation_input_tokens']),
      }
      if (subtype === 'success') {
        return { kind: 'result', sessionId, reason: 'end_turn', usage }
      }
      // 业务级错误(budget/turns/structured)→ E
      if (
        subtype === 'error_max_turns'
        || subtype === 'error_max_budget_usd'
        || subtype === 'error_max_structured_output_retries'
      ) {
        return {
          kind: 'error',
          sessionId,
          errorCode: subtype,
          message: subtype,
          error: m,
        }
      }
      // error_during_execution / 其它 → 拼 errors 数组
      const errors = Array.isArray(m['errors'])
        ? m['errors'].filter((v): v is string => typeof v === 'string')
        : []
      return {
        kind: 'error',
        sessionId,
        errorCode: subtype ?? 'error_during_execution',
        message: errors.join('; ') || subtype || 'SDK execution failed',
        error: m,
      }
    }
    case 'error': {
      return {
        kind: 'error',
        sessionId,
        errorCode: (m['error'] as string | undefined) ?? 'sdk_error',
        message: (m['message'] as string | undefined) ?? 'unknown error',
        error: m,
      }
    }
    default:
      return null
  }
}

export function createClaudeCodeProvider(opts: ClaudeCodeProviderOptions): AIProvider {
  const ccSwitch = opts.ccSwitch
  const debug = opts.debug ?? false
  const permissionHook = opts.permissionHook
  const assembler = opts.assembler
  const retrySleep = opts.retrySleep
  const sessionLogger = opts.sessionLogger
  const onSessionCancelled = opts.onSessionCancelled
  const globalLogger = opts.globalLogger

  // Task 7:Provider 共享的 FIFO limiter(顶层只创建一次);null 表示不限流
  const circuitBreaker: CircuitBreaker | null = opts.circuitBreaker === null
    ? null
    : (opts.circuitBreaker ?? new DefaultCircuitBreaker({ limit: 5 }))

  /** Lazy import SDK —— 避免启动时拉 cli 子进程 */
  let cachedQuery: QueryFn | null = opts.queryFn ?? null
  async function getQuery(): Promise<QueryFn> {
    if (cachedQuery) return cachedQuery
    const mod = await import('@anthropic-ai/claude-agent-sdk')
    cachedQuery = ((params: { prompt: string; options?: Record<string, unknown> }) =>
      mod.query(params)) as unknown as QueryFn
    return cachedQuery
  }

  /**
   * 解析 model id —— Q9.1:
   *   1. selection 存在? → 查 (providerId, role) → model id;provider 不存在或 role 没配 → fallback
   *   2. selection 缺失 / fallback → current provider.models.main
   * 失败 → 返回 null(让 SDK 自己默认)
   */
  function resolveModelId(selection: ModelSelection | undefined): string | null {
    let provider: ProviderIndex | undefined
    if (selection) {
      provider = ccSwitch.getById(selection.providerId) ?? undefined
    }
    if (!provider) {
      provider = ccSwitch.getCurrent() ?? undefined
    }
    if (!provider) return null
    if (selection) {
      const roleModel = provider.models[selection.role]
      if (roleModel) return roleModel
    }
    return provider.models.main ?? null
  }

  /**
   * 构造 per-session SdkAdapter —— 闭包捕获该 session 已解析的 modelId + cwd。
   * - model 从 selection 解析(Q9.1);空时 fallback 到 'sonnet'
   * - cwd 透传 createOpts.cwd;P0 默认 process.cwd()
   * - resume 透传 sdkSessionId (Q3)
   * - abortController 由 signal 包出 (Q8.2) —— 具名 abort,便于 finally removeEventListener
   * - appendSystemPrompt(Q5.1) + hooks(Q6.1) 由 AISession.send 阶段计算后透传
   */
  function buildAdapter(sessionModelId: string | null, sessionCwd: string | undefined): SdkAdapter {
    return {
      async *runTurn({ prompt, resume, appendSystemPrompt, signal }): AsyncIterable<SdkMessageEnvelope> {
        const q = await getQuery()

        // 构造 SDK Options —— 用 model + (optional) resume + cwd + env (baseUrl/apiKey)
        const provider = ccSwitch.getCurrent()
        const sdkOptions: Record<string, unknown> = {}
        if (provider) {
          // 透传 baseUrl + apiKey 到 SDK 子进程 env (SDK 文档:env 替换而非合并)
          const env: Record<string, string> = {}
          if (provider.baseUrl) env['ANTHROPIC_BASE_URL'] = provider.baseUrl
          if (provider.apiKey) env['ANTHROPIC_AUTH_TOKEN'] = provider.apiKey
          if (Object.keys(env).length > 0) sdkOptions['env'] = env
        }
        if (resume) sdkOptions['resume'] = resume
        if (appendSystemPrompt && appendSystemPrompt.length > 0) {
          sdkOptions['appendSystemPrompt'] = appendSystemPrompt
        }
        // Q6:wire PreToolUse hook —— SDK 期望 { hooks: HookCallbackMatcher[] }
        // HookCallbackMatcher = { matcher?, hooks: HookCallback[] }
        if (permissionHook) {
          sdkOptions['hooks'] = {
            PreToolUse: [{ hooks: [permissionHook.callback] }],
          }
        }
        const controller = new AbortController()
        let abortHandler: (() => void) | null = null
        if (signal) {
          if (signal.aborted) {
            controller.abort(signal.reason)
          } else {
            // 具名 listener,便于 finally 中清理
            abortHandler = () => controller.abort(signal.reason)
            signal.addEventListener('abort', abortHandler, { once: true })
          }
        }
        try {
          sdkOptions['abortController'] = controller
          sdkOptions['cwd'] = sessionCwd ?? process.cwd()
          // model 字段:selection 在 createSession 阶段已解析为 model id 字符串(SDK 接受 model id,见 spike A2)
          sdkOptions['model'] = sessionModelId ?? 'sonnet'

          if (debug) {
            console.log(
              `[ClaudeCodeProvider] runTurn model=${sdkOptions['model']} resume=${resume ?? '<none>'} cwd=${sdkOptions['cwd']} promptAppended=${appendSystemPrompt ? 'yes' : 'no'} hookWired=${permissionHook ? 'yes' : 'no'}`,
            )
          }

          const stream = q({ prompt, options: sdkOptions })
          for await (const raw of stream) {
            const env = toEnvelope(raw)
            if (env) yield env
            // 没识别的 SDK message 也吃掉 —— 不让 raw 漏出去
          }
        } finally {
          if (abortHandler && signal) signal.removeEventListener('abort', abortHandler)
        }
      },
    }
  }

  return {
    name: 'claude-code',

    async createSession(reqId: string, createOpts: CreateSessionOptions): Promise<IAISession> {
      // Task 7:ResumeManager / spike route 传入稳定 localSid;未传时由 Provider 生成 UUID
      const localSid = createOpts.localSid ?? randomUUID()
      if (debug) {
        console.log(
          `[ClaudeCodeProvider] createSession reqId=${reqId} localSid=${localSid} kind=${createOpts.kind}`,
        )
      }

      // Q9.1:在 session 创建阶段把 (providerId, role) 解析成 model id,
      // 由 per-session adapter 闭包捕获 —— send() 时直接用
      const modelId = resolveModelId(createOpts.model)

      // requirement 上下文:从 meta.yaml 读;provider 这里拿不到 fs,所以让 AISession 用 process.cwd() 兜底
      const requirement: AssemblerRequirement | undefined = undefined

      const adapter = buildAdapter(modelId, createOpts.cwd)
      const session = new AiSession({
        id: localSid,
        reqId,
        topic: createOpts.topic,
        kind: createOpts.kind,
        adapter,
        initialSdkSessionId: createOpts.resume,
        resolveModel: () => createOpts.model,
        signal: createOpts.signal,
        circuitBreaker: circuitBreaker ?? undefined,
        retrySleep,
        sessionLogger,
        globalLogger,
        onCancelled: onSessionCancelled,
        debug,
        assembler,
        requirement,
      })

      return session
    },

    async shutdown(): Promise<void> {
      // Task 7:shutdown 顺序 —— 先 close limiter(拒绝所有排队中的 waiter),
      // 再清 queryFn 缓存(已经走完的 query 自然退出,正在跑的 query 不被打断)
      circuitBreaker?.close()
      cachedQuery = null
    },
  }
}

/** 类型辅助 —— 重导出供 route 直接消费 */
export type { ModelRole, ProviderIndex }
