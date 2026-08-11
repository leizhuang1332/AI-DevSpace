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
 * - **shutdown 顺序** —— 先 providerSemaphore.close()(拒绝所有队列中的 waiter),
 *   再清 queryFn 缓存(已经走完的 query 自然退出)
 */

import { randomUUID } from 'node:crypto'
import { AiSession } from '../session/AISession.js'
import type { SdkAdapter, SdkMessageEnvelope, SdkUsage } from '../session/AISession.js'
import type { AnyZodRawShape } from '@anthropic-ai/claude-agent-sdk'
import type {
  AIProvider,
  AISession as IAISession,
  ChatQueryCapableProvider,
  ChatQueryInput,
  ChatQueryResult,
  CreateSessionOptions,
  ModelSelection,
} from './AIProvider.js'
import type { CcSwitchClient, ModelRole, ProviderIndex } from './CcSwitchClient.js'
import type { PermissionHook } from '../tools/PermissionHook.js'
import type {
  SystemPromptAssembler,
  AssemblerRequirement,
} from '../prompt/SystemPromptAssembler.js'
import type { ProviderSemaphore } from '../error/ProviderSemaphore.js'
import { ProviderSemaphore as DefaultProviderSemaphore } from '../error/ProviderSemaphore.js'
import type { SessionLogger } from '../log/SessionLogger.js'
import type { GlobalLogger } from '../log/GlobalLogger.js'
import type { SessionStore } from '../session/SessionStore.js'
import type { CachedDefault } from './defaultSystemPromptCache.js'

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
  providerSemaphore?: ProviderSemaphore | null
  /** Task 5:retry sleep 钩子(测试可注入) */
  retrySleep?: RetrySleep
  /** Task 4:session 级 query 日志 */
  sessionLogger?: SessionLogger
  /** Task 4:用户取消回调 */
  onSessionCancelled?: OnSessionCancelled
  /** Task 4:全局结构化日志 */
  globalLogger?: GlobalLogger
  /** P4 · Task 3:SessionStore —— 用于 send 成功后回写 meta.yaml.last_input */
  sessionStore?: SessionStore
  /** P4 · Task 4:createSession 完成后回调 —— server 用于把 session 注册到 retry registry */
  onSessionCreated?: (session: RetryableSession) => void
  /** P4 · Task 5:query 生命周期事件回调 —— server 借此 publish query_succeeded 到 SSE */
  onLifecycle?: (event: { type: 'query_succeeded'; runId: string; durationMs: number; attempts: number; ts: number; reqId: string; sessionId: string }) => void
  /** P5 · Q10.4:session state 变化 observer —— 透传到每个新建的 AISession */
  onSessionStateChange?: SessionStateObserver
  /**
   * SDK 原始 default system prompt 读取器(同步)。
   * 返回 null 表示没有 cache —— dump 块会打 "(NOT CACHED)" 提示用户去跑 capture 脚本。
   * Provider 不负责捕获,只负责读取;捕获由 server 启动或独立脚本触发。
   */
  defaultSystemPromptReader?: () => CachedDefault | null
}

/** P4 · Task 4:retry registry 需要的最小 AISession 形态 */
export interface RetryableSession {
  readonly id: string
  readonly reqId: string
  send(text: string, opts?: { isRetry?: boolean } | ReadonlyArray<unknown>): Promise<void>
}

/** P5 · Q10.4:state-change observer 形态 —— server 注入,Provider 透传到 AISession */
export type SessionStateObserver = (event: {
  localSid: string
  reqId: string
  state: 'idle' | 'busy' | 'closed' | 'errored'
  ts: number
}) => void

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

// ---------------------------------------------------------------------------
// Module-level SDK query cache —— 跨 runAnalysisQuery / runChatQuery 共享,
// 测试可注入 queryFn mock,生产懒加载 SDK。
// ---------------------------------------------------------------------------

/** Lazy import SDK —— 避免启动时拉 cli 子进程 */
let moduleCachedQuery: QueryFn | null = null
async function getModuleQuery(): Promise<QueryFn> {
  if (moduleCachedQuery) return moduleCachedQuery
  const mod = await import('@anthropic-ai/claude-agent-sdk')
  moduleCachedQuery = ((params: { prompt: string; options?: Record<string, unknown> }) =>
    mod.query(params)) as unknown as QueryFn
  return moduleCachedQuery
}

/** 测试可注入 SDK query mock —— 必在 createClaudeCodeProvider 之前调用 */
export function __setSdkQueryForTest(q: QueryFn | null): void {
  moduleCachedQuery = q
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
  const sessionStore = opts.sessionStore
  const onSessionCreated = opts.onSessionCreated
  const onLifecycle = opts.onLifecycle
  const defaultSystemPromptReader = opts.defaultSystemPromptReader
  const onSessionStateChange = opts.onSessionStateChange

  // Task 7:Provider 共享的 FIFO limiter(顶层只创建一次);null 表示不限流
  const providerSemaphore: ProviderSemaphore | null = opts.providerSemaphore === null
    ? null
    : (opts.providerSemaphore ?? new DefaultProviderSemaphore({ limit: 5 }))

  // 注入测试 queryFn(若有)到 module 缓存 —— Provider 闭包与 chat 路径共享
  if (opts.queryFn) moduleCachedQuery = opts.queryFn

  /** Provider 闭包内 query —— 复用 module 缓存 */
  async function getQuery(): Promise<QueryFn> {
    return getModuleQuery()
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

          // ── always-on full prompt dump ─────────────────────────────────
          // 把「真正进入 Claude Code 子进程」的 prompt + appendSystemPrompt +
          // SDK options 全量打到 stdout;Skill body 可能 30~100KB,跑分析时
          // 噪声大,但排查「模型究竟收到什么」是最直接的取证方式。
          const dumpSdkOptions: Record<string, unknown> = {}
          for (const k of [
            'model',
            'resume',
            'cwd',
            'env',
            'permissionMode',
            'allowedTools',
            'disallowedTools',
          ]) {
            const v = sdkOptions[k]
            if (v !== undefined) dumpSdkOptions[k] = v
          }
          if (sdkOptions['hooks']) {
            dumpSdkOptions['hooks'] = Object.keys(sdkOptions['hooks'] as Record<string, unknown>)
          }
          console.log('[ClaudeCodeProvider] ═══ runTurn prompt dump ═══')
          console.log(`[ClaudeCodeProvider] ── prompt (${prompt.length} chars) ──`)
          console.log(prompt)
          // SDK 原始 default system prompt —— 由 defaultSystemPromptReader 提供
          // (capture 流程见 ./defaultSystemPromptCache.ts)
          const cachedDefault = defaultSystemPromptReader?.() ?? null
          if (cachedDefault) {
            console.log(
              `[ClaudeCodeProvider] ── sdk default system prompt (cached, claude ${cachedDefault.claude_version}, captured ${cachedDefault.captured_at}, ${cachedDefault.system_combined_chars} chars across ${cachedDefault.system_blocks.length} blocks) ──`,
            )
            for (const [i, block] of cachedDefault.system_blocks.entries()) {
              console.log(
                `[ClaudeCodeProvider]   [block ${i}] type=${block.type} chars=${block.text.length} cache_control=${JSON.stringify(block.cache_control) ?? '<none>'}`,
              )
              console.log(block.text)
            }
          } else {
            console.log(
              '[ClaudeCodeProvider] ── sdk default system prompt: (NOT CACHED) ──',
            )
            console.log(
              '[ClaudeCodeProvider]   run `node apps/agent/scripts/capture-default-system-prompt.mjs` (or set AIDEVSPACE_CAPTURE_DEFAULT_SYSTEM_PROMPT=1 at server startup) to capture once.',
            )
          }
          console.log(
            `[ClaudeCodeProvider] ── appendSystemPrompt (${appendSystemPrompt?.length ?? 0} chars) ──`,
          )
          console.log(appendSystemPrompt ?? '<none>')
          console.log('[ClaudeCodeProvider] ── sdk options ──')
          console.log(JSON.stringify(dumpSdkOptions, null, 2))
          console.log('[ClaudeCodeProvider] ═══ end prompt dump ═══')

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

    /**
     * Analysis Run 路径专用:直接调 SDK `query({prompt, options:{systemPrompt,
     * mcpServers, allowedTools, cwd}})`,不走 AISession 包装。
     *
     * 用途:AnalysisAgentRunner 需要把 system prompt **完全替换**(SDK
     * `systemPrompt: string`)并通过 in-process MCP server 注入业务工具
     * `report_analysis_issue` / `complete_analysis`。
     *
     * **不**复用 `provider.createSession + session.send` 路径 —— 那条
     * 路径假设 system prompt 走 appendSystemPrompt,且 AISession 的
     * retry loop 会干扰业务工具同步 handler 的语义。
     */
    runAnalysisQuery: (async (input: {
      prompt: string
      systemPrompt: string
      cwd: string
      allowedTools: ReadonlyArray<string>
      businessTools: Record<string, (toolUseId: string, args: unknown) => unknown>
      /** 业务工具 description 覆盖(可选,key 为 tool 名)。issue 13 引入:
       *  caller(如 PrdSplitRunner)注入与自身 system prompt 语义对齐的 description,
       *  避免模型读到「Analysis Run」字样错配不调用工具。不传走默认。 */
      businessToolDescriptions?: Record<string, string>
      onEvent: (envelope: unknown) => void
    }) => {
      try {
        const q = await getQuery()
        const providerIndex = ccSwitch.getCurrent()
        const sdkOptions: Record<string, unknown> = {
          systemPrompt: input.systemPrompt,
          cwd: input.cwd,
          allowedTools: [...input.allowedTools],
          disallowedTools: [
            'Bash',
            'Write',
            'Edit',
            'MultiEdit',
            'NotebookEdit',
            'WebSearch',
            'WebFetch',
          ],
          permissionMode: 'default',
          model: 'sonnet',
        }
        if (providerIndex) {
          const env: Record<string, string> = {}
          if (providerIndex.baseUrl) env['ANTHROPIC_BASE_URL'] = providerIndex.baseUrl
          if (providerIndex.apiKey) env['ANTHROPIC_AUTH_TOKEN'] = providerIndex.apiKey
          if (Object.keys(env).length > 0) sdkOptions['env'] = env
        }

        // SDK 0.3.206 会按 zod raw shape 过滤工具参数,每个 MCP tool 必须显式声明
        // 可接收字段(true 必填校验仍由 handler 完成)。
        //
        // issue 13(0 卡静音成功真因):旧实现 `non-report_issue 工具全部走 z.object({})
        // .passthrough()` —— zod→JSON Schema 时 passthrough 转 JSON Schema 丢成空
        // properties,模型看到的 schema 没有字段定义;实际调用 SDK 把模型 args 丢掉
        // → wrapper 永远拿到空对象/title missing。新方案:每个业务工具一份明确的 shape,
        // 与 report_analysis_issue 一等公民。
        const sdkModule = await import('@anthropic-ai/claude-agent-sdk')
        const { z } = await import('zod')
        const reportIssueArgsShape = z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            source_refs: z.array(z.unknown()).optional(),
            metadata: z.unknown().optional(),
          })
          .shape
        // issue 13:propose_card 4 显式字段 + passthrough 兜底(允许模型加自定义字段)
        const proposeCardArgsShape = z
          .object({
            title: z.string().optional(),
            content: z.string().optional(),
            suggested_priority: z
              .enum(['low', 'medium', 'high', 'urgent'])
              .nullable()
              .optional(),
            labels: z.array(z.string()).optional(),
          })
          .passthrough()
          .shape
        // 业务工具名 → schema 形参(其他 runner 接入时按需扩)
        const argsShapeFor = (name: string): AnyZodRawShape => {
          if (name === 'report_analysis_issue') return reportIssueArgsShape
          if (name === 'propose_card') return proposeCardArgsShape
          // 未登记工具兜底:全 passthrough 但不锁字段(新工具接入时易被
          // 0-字段 schema 坑 → 主动 fallback,需要 runner 显式登记)
          return z.object({}).passthrough().shape
        }
        // PR-4 (ticket 10):per-Run 自增 counter —— 此前 module-level 单例
        // (`mcpCallCounter`)在长寿命进程跑几十次 Run 后会上千,且跨 Run
        // 状态共享容易在并发 attempt 上产生 race。改成 runAnalysisQuery
        // 闭包内局部变量,每次 Run 启动时归零,闭包结束自动释放。
        let perRunCounter = 0
        // issue 13:description caller 注入优先,默认走通用表述。
        // 旧硬编码「Analysis Run 业务工具:... 由 AnalysisAgentRunner 在 handler
        // 内执行持久化」会让 PrdSplitRunner 路径的 propose_card 拿到错位 description,
        // 模型读 metadata 后谨慎 end_turn → 0 卡静音成功。
        const defaultDescription = (name: string): string =>
          `平台业务工具:${name}。由对应 runner 在 handler 内执行持久化与 SSE 推送。`
        const mcpServer = sdkModule.createSdkMcpServer({
          name: 'analysis-run-tools',
          version: '1.0.0',
          tools: Object.entries(input.businessTools).map(([name, handler]) =>
            sdkModule.tool(
              name,
              input.businessToolDescriptions?.[name] ?? defaultDescription(name),
              argsShapeFor(name),
              async (args: unknown) => {
                // 这里无法拿 SDK 端 tool_use_id(SDK 不透传)——
                // 我们用一个 Run 内自增 counter 生成 key,作为幂等键传给 handler。
                // counter 限定在本次 Run 闭包内,Run 结束即释放,跨 Run 不污染。
                const toolUseId = `mcp-${name}-${++perRunCounter}`
                const result = await handler(toolUseId, args)
                // CallToolResult 形态:content 是 MCP 内容块数组
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify(result),
                    },
                  ],
                }
              },
            ),
          ),
        })
        sdkOptions['mcpServers'] = { analysis: mcpServer }

        const stream = q({ prompt: input.prompt, options: sdkOptions })
        let sawResult = false
        let lastError: string | null = null
        for await (const raw of stream) {
          const m = raw as Record<string, unknown>
          input.onEvent({ kind: 'raw', raw: m })
          if (m['type'] === 'result') {
            sawResult = true
            const subtype = m['subtype'] as string | undefined
            if (subtype && subtype !== 'success') {
              lastError = subtype
            }
          }
          if (m['type'] === 'error') {
            const errField = m['error']
            lastError =
              typeof errField === 'string'
                ? errField
                : String((errField as Record<string, unknown> | undefined)?.['message'] ?? 'SDK error')
          }
        }
        if (!sawResult) {
          return { ok: false, error: 'SDK stream closed without result envelope' }
        }
        if (lastError) {
          return { ok: false, error: lastError }
        }
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }) as AIProvider['runAnalysisQuery'],

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
        providerSemaphore: providerSemaphore ?? undefined,
        retrySleep,
        sessionLogger,
        globalLogger,
        sessionStore,
        onCancelled: onSessionCancelled,
        // P4 · Task 5:把 reqId/sessionId 注入到 lifecycle payload,便于 server hub.publish
        onLifecycle: onLifecycle
          ? (ev) => onLifecycle({ ...ev, reqId, sessionId: session.id })
          : undefined,
        // P5 · Q10.4:把 sessionState observer 透传到每个新 AISession,
        // observer 内已携带 reqId/localSid,不需要在这里再注入
        onStateChange: onSessionStateChange,
        debug,
        // ticket 01 (ADR-0020 D8):per-session assembler 覆盖 ——
        // 双 turn 编排需 turn-1 装 admission-check body,turn-2 装
        // requirement-brainstorm body。未传时回落 Provider 默认 assembler。
        assembler: createOpts.assembler ?? assembler,
        requirement,
      })

      // P4 · Task 4:通知 server 把 session 注册到 retry registry
      if (onSessionCreated) {
        onSessionCreated({
          id: session.id,
          reqId: session.reqId,
          send: (text, opts) => session.send(text, opts),
        })
      }

      return session
    },

    async shutdown(): Promise<void> {
      // Task 7:shutdown 顺序 —— 先 close limiter(拒绝所有排队中的 waiter),
      // 再清 queryFn 缓存(已经走完的 query 自然退出,正在跑的 query 不被打断)
      providerSemaphore?.close()
      moduleCachedQuery = null
    },

    /**
     * board chat 路径(ADR-0029 D4) —— 独立命名空间,不进入 runAnalysisQuery
     * 闭包;per query 独立 counter,守门契约见 ADR-0023 D11。
     *
     * 当前 commit:RED 守门占位,issue 03+04 实现走 GREEN。
     */
    runChatQuery,
  }
}

/** 类型辅助 —— 重导出供 route 直接消费 */
export type { ModelRole, ProviderIndex }

// ============================================================================
// Board chat 路径(issue 03 · ADR-0029 D4 / D9 / D10 / D11)
//
// 守门契约(ADR-0023 D11 + ADR-0029 D11):
// - 本方法签名锁定后,任何修改必先 RED 后 GREEN
// - chat 路径**不**进入 runAnalysisQuery 闭包,不污染 `perRunCounter`
//   (issue 02 守门 contract)
// - chat 路径**不**复用 analysis-run-tools MCP server,独立 boardchat 命名空间
// - provider 内**新增**字段:session.json 17 项元数据走 ChatSessionService,
//   不在 Provider 内自行落盘(Provider 只负责 SDK query 协议层)
//
// 当前 commit 状态:RED 守门 — 占位实现,throw not-implemented;
// 后续 issue 03 (ChatSessionService) + 04 (MCP permission handler)
// + 05 (board chat route) 实现走 GREEN。
// ============================================================================

/** board chat MCP tool 固定名 —— 透传到 SDK options.permissionPromptToolName
 *  (与 packages/shared/src/board-chat.ts 的
 *   ChatSessionMetaSchema.permissionPromptToolName 字面对齐) */
export const CHAT_PERMISSION_PROMPT_TOOL_NAME =
  'mcp__boardchat__user_confirm' as const

/** board chat MCP server 名称 —— SDK 拼成 `mcp__<name>__<toolName>` */
export const CHAT_MCP_SERVER_NAME = 'boardchat' as const

// ============================================================================
// 敏感模式(ADR-0029 D5 决策 31 + issue 04)
// 硬编码黑名单:handler 端拦截,即使 auto-allow / permit cache 命中也强制弹 modal
// 永弹语义:任何匹配项 → SSE permission_request.forced=true → UI 强制弹 modal
// ============================================================================

/** 敏感模式列表(issue 04):rm -rf /, chmod 777, mkfs, dd, git push --force, curl | sh
 *
 * 命中字段:主要 Bash command;Write / Edit 的 content 字段同样扫描(防止把
 * 危险 shell 写到文件然后用其它方式执行)。
 *
 * 注意:每条正则都用 \b 词边界;允许中间有额外短选项(`-[a-z]+`)。 */
export const SENSITIVE_PATTERNS: ReadonlyArray<{
  /** 匹配规则 —— 任意字段内容命中即视为敏感 */
  pattern: RegExp
  /** 命中后给 UI 的提示(description 文本) */
  description: string
}> = [
  { pattern: /\brm\s+(-\w+\s+)*-\w*r\w*f\w*\s+\//, description: 'rm -rf /' },
  { pattern: /\bchmod\s+777\b/, description: 'chmod 777' },
  { pattern: /\bmkfs(\.\w+)?\b/, description: 'mkfs(格式化磁盘)' },
  { pattern: /\bdd\b[^\n|]*\bof=\/dev\//, description: 'dd of=/dev/(磁盘覆写)' },
  { pattern: /\bgit\s+push\b[^\n|]*--force\b/, description: 'git push --force' },
  { pattern: /\bcurl\b[^\n|]*\|\s*(ba)?sh\b/, description: 'curl | sh(远程脚本执行)' },
]

/** 检测 args 中是否含敏感模式;命中返 description,未命中返 null。
 *
 * 扫描字段:
 * - `command` —— Bash 主命令
 * - `content` —— Write / Edit / MultiEdit 写入内容(防止把危险 shell 嵌入文件)
 * - `new_string` —— Edit 替换字符串
 * - 整个 JSON 序列化后字符串 —— 兜底(防止写到自定义字段) */
export function detectSensitivePattern(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  const candidates: string[] = []
  // Bash: command 字段
  if (typeof obj['command'] === 'string') candidates.push(obj['command'] as string)
  // Write / Edit / MultiEdit: content / new_string 字段
  if (typeof obj['content'] === 'string') candidates.push(obj['content'] as string)
  if (typeof obj['new_string'] === 'string') candidates.push(obj['new_string'] as string)
  // 兜底:全 JSON 字符串(防止写到自定义字段)
  try {
    candidates.push(JSON.stringify(input))
  } catch {
    /* circular ref 等极端情况跳过 */
  }
  for (const text of candidates) {
    for (const { pattern, description } of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) return description
    }
  }
  return null
}

/** per-call cache key:`toolName + JSON.stringify(inputArgs)` */
function permitCacheKey(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}::${JSON.stringify(input)}`
}

/** Plan mode 下 SDK 的退出工具 —— 走到 handler 时返 `setMode: 'default'` 切回默认 mode */
const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode' as const

/** 从 SDK 透传的 rawArgs 解出 user_confirm handler 入参形态。
 *
 * 抽 helper 解 Repeated Switches / Data Clumps:6 字段在 handler 闭包内多处使用
 * (SSE emit / handler call / cache key / SSE resolved),集中一处转换,语义清晰
 * 且容错统一。缺字段返空串 / 空对象,handler 仍能跑(fail-closed 防御)。 */
function extractPermissionRequest(
  rawArgs: unknown,
  fallbackToolUseId: string,
): {
  toolName: string
  requestId: string
  input: Record<string, unknown>
  displayName?: string
  title?: string
  description?: string
} {
  const args = (rawArgs ?? {}) as Record<string, unknown>
  const toolName =
    typeof args['toolName'] === 'string' ? (args['toolName'] as string) : ''
  const requestId =
    typeof args['requestId'] === 'string'
      ? (args['requestId'] as string)
      : fallbackToolUseId
  const input =
    typeof args['input'] === 'object' &&
    args['input'] !== null &&
    !Array.isArray(args['input'])
      ? (args['input'] as Record<string, unknown>)
      : {}
  return {
    toolName,
    requestId,
    input,
    displayName:
      typeof args['displayName'] === 'string'
        ? (args['displayName'] as string)
        : undefined,
    title: typeof args['title'] === 'string' ? (args['title'] as string) : undefined,
    description:
      typeof args['description'] === 'string'
        ? (args['description'] as string)
        : undefined,
  }
}

/**
 * Board chat 路径:per-TaskCard SDK session 直 query,不进 AISession 包装。
 *
 * 实现要求(issue 03 / 04 / 05 锁定):
 * - `options.resume` 透传 `resumeSessionId`(首次 query 留空)
 * - `options.cwd` = `board/tasks/<ulid>/` 绝对路径
 * - `options.additionalDirectories` = 父 req dir + worktree
 * - `options.permissionPromptToolName` = `mcp__boardchat__user_confirm`
 *   —— SDK 触发时调我们注入的 `user_confirm` MCP tool handler
 * - `options.mcpServers.boardchat` = createSdkMcpServer({name:'boardchat',
 *   tools:[tool('user_confirm', ..., z.object({...}), async args => {...})]})
 * - handler 收 SDK 入参(toolName / input / requestId / displayName / title /
 *   description)→ 推到 SSE `chat_permission_request` → 等决议 → 返
 *   `{behavior: 'allow'|'deny', ...}`
 * - `mcp__boardchat__user_confirm` handler 内**独立** counter(per chat query
 *   闭包),不共享 `runAnalysisQuery` 的 `perRunCounter`
 *
 * @see ChatQueryCapableProvider / ChatQueryInput 定义
 */
const runChatQuery: ChatQueryCapableProvider['runChatQuery'] = async (
  input: ChatQueryInput,
): Promise<ChatQueryResult> => {
  return chatQuery(input)
}

/**
 * chat 路径 SDK query 入口 —— 命名空间分离(issue 03 要求 provider 内部
 * 实现命名 `chatQuery()` / `chatQueryStream()`,不进入 Analysis Run 闭包)。
 *
 * 协议步骤:
 * 1. 构造 SDK options:permissionPromptToolName / cwd / additionalDirectories /
 *    model / permissionMode / mcpServers.boardchat(user_confirm tool 注册)
 * 2. 若 resumeSessionId 存在 → options.resume = resumeSessionId
 * 3. 调 queryFn → 消费 SDK event 流:
 *    - `system/init` → onEvent({kind:'session_init', sessionId, cwd, model})
 *    - `stream_event.content_block_delta.text_delta` → onEvent({kind:'message_assistant', partial:true, text})
 *    - `stream_event.task_started/progress/completed` → onEvent({kind:'task_*'})
 *    - `result(success)` → onEvent({kind:'complete', sessionId, totalTokens, cost, reason:'end_turn'})
 *    - 其它 envelope → 透传 onEvent
 * 4. user_confirm MCP tool handler(per-query 闭包内 counter):
 *    - 收 SDK 入参 → 调 input.userConfirmHandler → 返 CallToolResult
 *
 * 不直接调用 `runAnalysisQuery` / 共享 `mcpCallCounter`(issue 02 守门)。
 */
async function chatQuery(input: ChatQueryInput): Promise<ChatQueryResult> {
  const sdkModule = await import('@anthropic-ai/claude-agent-sdk')
  const { z } = await import('zod')

  // 1) 注册 user_confirm MCP tool —— 独立 per-query counter(不共享 analysis-run)
  let perChatQueryCounter = 0
  // In-memory permit cache(per chat query 闭包):同 (toolName, args) 二次确认
  // → 自动 allow,不调 userConfirmHandler(issue 04 · ADR-0029 D5)
  const permitCache = new Map<
    string,
    {
      behavior: 'allow'
      updatedPermissions?: ReadonlyArray<unknown>
      reason?: string
    }
  >()

  const userConfirmTool = sdkModule.tool(
    'user_confirm',
    'Board chat permission gate. Asks the user via SSE before the SDK executes ' +
      'a tool that needs approval (Write / Edit / Bash / etc).',
    z
      .object({
        requestId: z.string().optional(),
        toolName: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        displayName: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        cwd: z.string().optional(),
        /** 候选决议(SDK 0.3.206 在某些模式下携带)—— schema 接受即可,不强制使用 */
        suggestions: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .shape,
    /**
     * user_confirm MCP tool handler —— issue 04 锁定契约:
     *
     * 1. 推 SSE `chat_permission_request` 在调 userConfirmHandler 前
     *    (便于 web 弹 modal;route 层收到即阻塞等决议)
     * 2. 敏感模式永弹:args 命中 SENSITIVE_PATTERNS → SSE permission_request.forced=true,
     *    跳过 permit cache,永远走 userConfirmHandler(即使之前 allow 过)
     * 3. In-memory permit cache:同 (toolName, args) 第二次 → 直接返 cached allow,
     *    不调 userConfirmHandler(deny 不写入 cache)
     * 4. Plan mode ExitPlanMode 协议:`permissionMode === 'plan'` 且 toolName === 'ExitPlanMode'
     *    → 返 `{behavior: 'allow', setMode: 'default'}`,不调 userConfirmHandler
     * 5. fail-closed:任何路径都返非空 CallToolResult(null = SDK 永久阻塞)
     */
    async (rawArgs: unknown) => {
      // 生成 per-call toolUseId(独立 counter)
      const toolUseId = `mcp-user_confirm-${++perChatQueryCounter}`
      const ts = Date.now()
      const req = extractPermissionRequest(rawArgs, toolUseId)
      const { toolName, requestId, input: inputArgs } = req

      // ---- Plan mode ExitPlanMode 协议(issue 04 锁定) -----------------
      // SDK 在用户接受 plan 时调我们 handler 退出 plan mode,返
      // `{behavior: 'allow', setMode: 'default'}` 切回默认 mode。
      // 此路径不调 userConfirmHandler(SDK-internal 流程)。
      if (input.permissionMode === 'plan' && toolName === EXIT_PLAN_MODE_TOOL_NAME) {
        const planPayload = {
          behavior: 'allow' as const,
          setMode: 'default' as const,
          toolUseId,
        }
        input.onEvent({ kind: 'permission_resolved', ts, requestId })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(planPayload) }],
        }
      }

      // ---- 敏感模式检测(issue 04 锁定) --------------------------------
      // 命中 SENSITIVE_PATTERNS → forced:true + 跳过 permit cache,永远走真路径
      const sensitiveMatch = detectSensitivePattern(inputArgs)
      const isSensitive = sensitiveMatch !== null

      // ---- Permit cache 检查(非敏感模式才走 cache) -------------------
      if (!isSensitive) {
        const cached = permitCache.get(permitCacheKey(toolName, inputArgs))
        if (cached) {
          // cache 命中:直接返 cached allow + 推 permission_resolved SSE
          // (不发 permission_request,因为没真向 web 弹 modal)
          input.onEvent({ kind: 'permission_resolved', ts, requestId })
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ...cached, toolUseId }),
              },
            ],
          }
        }
      }

      // ---- 推 SSE permission_request(在调 userConfirmHandler 前) -----
      // route 层收到此事件即阻塞等决议(POST /chat/.../permission)。
      input.onEvent({
        kind: 'permission_request',
        ts,
        requestId,
        toolName,
        input: inputArgs,
        displayName: req.displayName,
        title: req.title,
        description: req.description,
        ...(isSensitive && { forced: true }),
      })

      // ---- 调 caller-provided handler + fail-closed 防御 ------------
      // handler throw → 返 deny 决议(SDK 拿到非 null CallToolResult,不阻塞)
      let decision: Awaited<ReturnType<typeof input.userConfirmHandler>>
      try {
        decision = await input.userConfirmHandler({
          requestId,
          toolName,
          input: inputArgs,
          displayName: req.displayName,
          title: req.title,
          description: req.description,
        })
      } catch (handlerErr) {
        const message =
          handlerErr instanceof Error ? handlerErr.message : String(handlerErr)
        decision = { behavior: 'deny', message }
      }

      // ---- Permit cache 写入(allow + 非敏感才写入) ------------------
      if (decision.behavior === 'allow' && !isSensitive) {
        permitCache.set(permitCacheKey(toolName, inputArgs), {
          behavior: 'allow',
          updatedPermissions: decision.updatedPermissions,
          reason: decision.reason,
        })
      }

      // ---- 推 SSE permission_resolved(决议已落) ----------------------
      input.onEvent({ kind: 'permission_resolved', ts, requestId })

      // ---- 返 CallToolResult 形态(content: MCP 内容块数组) -----------
      // SDK 0.3.206 期望 {behavior: 'allow'|'deny', ...} 直接暴露在 content 中;
      // 这里用 JSON 文本块序列化 decision + toolUseId。
      const resultPayload = { ...decision, toolUseId }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(resultPayload) },
        ],
      }
    },
  )

  const mcpServer = sdkModule.createSdkMcpServer({
    name: CHAT_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [userConfirmTool],
  })

  // 2) 构造 SDK options —— cwd 由 ChatSessionService 注入的 frozenCwd 优先
  const effectiveCwd = input.frozenCwd ?? input.cwd
  const sdkOptions: Record<string, unknown> = {
    cwd: effectiveCwd,
    additionalDirectories: [...input.additionalDirectories],
    model: input.model,
    permissionMode: input.permissionMode,
    permissionPromptToolName: CHAT_PERMISSION_PROMPT_TOOL_NAME,
    mcpServers: { [CHAT_MCP_SERVER_NAME]: mcpServer },
  }
  if (input.resumeSessionId) {
    sdkOptions['resume'] = input.resumeSessionId
  }

  // 3) 调 queryFn —— 走注入的 query(测试用 mock,生产用 SDK)
  const q = await getModuleQuery()
  let observedSessionId = ''
  let lastReason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens' | null =
    null
  try {
    const stream = q({ prompt: input.prompt, options: sdkOptions })
    for await (const raw of stream) {
      const m = raw as Record<string, unknown>
      const type = m['type']
      const ts = Date.now()

      // system/init → session_init event + 记下 sessionId
      if (type === 'system' && m['subtype'] === 'init') {
        const sessionId =
          typeof m['session_id'] === 'string' ? (m['session_id'] as string) : ''
        observedSessionId = sessionId
        input.onEvent({
          kind: 'session_init',
          sessionId,
          cwd: typeof m['cwd'] === 'string' ? (m['cwd'] as string) : input.cwd,
          model: typeof m['model'] === 'string' ? (m['model'] as string) : input.model,
        })
        continue
      }

      // stream_event → content_block_delta / task_* 事件透传
      if (type === 'stream_event') {
        const event = m['event'] as Record<string, unknown> | undefined
        if (event) {
          const evType = event['type']
          if (evType === 'content_block_delta') {
            const delta = event['delta'] as Record<string, unknown> | undefined
            if (delta && delta['type'] === 'text_delta') {
              input.onEvent({
                kind: 'message_assistant',
                ts,
                text: typeof delta['text'] === 'string' ? (delta['text'] as string) : '',
                partial: true,
              })
            }
            continue
          }
          if (evType === 'task_started') {
            input.onEvent({
              kind: 'task_started',
              ts,
              taskId: typeof event['task_id'] === 'string' ? (event['task_id'] as string) : '',
              description:
                typeof event['description'] === 'string' ? (event['description'] as string) : '',
              agentType:
                typeof event['agent_type'] === 'string' ? (event['agent_type'] as string) : '',
            })
            continue
          }
          if (evType === 'task_progress') {
            input.onEvent({
              kind: 'task_progress',
              ts,
              taskId: typeof event['task_id'] === 'string' ? (event['task_id'] as string) : '',
              summary: typeof event['summary'] === 'string' ? (event['summary'] as string) : '',
            })
            continue
          }
          if (evType === 'task_completed') {
            input.onEvent({
              kind: 'task_completed',
              ts,
              taskId: typeof event['task_id'] === 'string' ? (event['task_id'] as string) : '',
              result: event['result'],
              durationMs:
                typeof event['duration_ms'] === 'number' ? (event['duration_ms'] as number) : 0,
            })
            continue
          }
        }
        continue
      }

      // result → complete event
      if (type === 'result') {
        const subtype = m['subtype'] as string | undefined
        const usage = (m['usage'] ?? {}) as Record<string, unknown>
        const totalTokensRaw = m['total_tokens']
        const totalTokens =
          typeof totalTokensRaw === 'number'
            ? totalTokensRaw
            : (typeof usage['input_tokens'] === 'number' ? (usage['input_tokens'] as number) : 0) +
              (typeof usage['output_tokens'] === 'number' ? (usage['output_tokens'] as number) : 0)
        const costRaw = m['total_cost_usd']
        const cost = typeof costRaw === 'number' ? costRaw : 0
        const reason =
          subtype === 'success'
            ? 'end_turn'
            : subtype === 'error_max_tokens'
              ? 'max_tokens'
              : subtype === 'cancelled'
                ? 'cancelled'
                : 'error'
        lastReason = reason
        input.onEvent({
          kind: 'complete',
          ts,
          sessionId: observedSessionId,
          totalTokens,
          cost,
          reason,
        })
        continue
      }

      // error → error event
      if (type === 'error') {
        input.onEvent({
          kind: 'error',
          ts,
          code: typeof m['code'] === 'string' ? (m['code'] as string) : 'sdk_error',
          message:
            typeof m['message'] === 'string' ? (m['message'] as string) : 'unknown error',
          recoverable: false,
        })
        continue
      }
    }
  } catch (err) {
    // issue 14 —— SDK CLI throw 路径下的 session-expired 自愈:
    // 真实调用链:SDK 调 `claude -p --resume <id>`,CLI 找不到该 sessionId
    // 时(典型:`/start` 用 FakeChatProvider 落 `sdk-fake-001` 非 UUID 假 id,
    // 后续切真 Provider 再 /query 真 CLI 找不到)—— CLI 退出码非 0,SDK 先
    // emit `result { subtype: 'error_during_execution' }`,再把 stderr 包成
    // Error throw 出来。issue 13 的 ok=true 分支 isSessionExpired 检测不
    // 覆盖这条路径;这里 catch 时按 error message 特征识别 resume-fail,
    // 标 isSessionExpired=true,路由层据此走端到端自愈(issue 13 的 SSE
    // `chat_error E_SESSION_EXPIRED` + 自动 reset)。
    const message = err instanceof Error ? err.message : String(err)
    const isSessionExpired =
      !!input.resumeSessionId &&
      /--resume requires a valid session ID|is not a UUID|does not match any session/i.test(
        message,
      )
    return {
      ok: false,
      error: message,
      isSessionExpired,
    }
  }

  // issue 13 —— 端到端自愈触发:SDK resume 一个已失效 sessionId 时,
  // 走 result { subtype ∉ success/error_max_tokens/cancelled } 路径,且
  // 始终没 emit system/init(observedSessionId 保持 '')。这是无声失败的
  // 标志,Provider 显式标 isSessionExpired = true,由路由层自动清理
  // stale session.json + 推 SSE `chat_error E_SESSION_EXPIRED`。
  const isSessionExpired =
    !!input.resumeSessionId &&
    observedSessionId === '' &&
    lastReason === 'error'
  return {
    ok: true,
    sessionId: observedSessionId,
    isSessionExpired,
  }
}

/**
 * chat 路径流式变体(issue 03 要求命名 chatQueryStream —— 当前实现
 * 与 chatQuery 共享 SDK queryFn,差异仅在结果语义;保留为公开 API 占位)。
 *
 * 当前 Provider.runChatQuery 通过 chatQuery 实现;若未来 SSE 推流需求
 * 进一步细化为"边收 SDK 事件边推 SSE",可在此函数内独立实现。
 */
export async function chatQueryStream(
  input: ChatQueryInput,
): Promise<ChatQueryResult> {
  return chatQuery(input)
}

