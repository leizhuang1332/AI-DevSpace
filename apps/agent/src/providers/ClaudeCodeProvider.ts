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
 */

import { randomUUID } from 'node:crypto'
import { AiSession } from '../session/AISession.js'
import type { SdkAdapter, SdkMessageEnvelope } from '../session/AISession.js'
import type {
  AIProvider,
  AISession as IAISession,
  CreateSessionOptions,
  ModelSelection,
} from './AIProvider.js'
import { CcSwitchClient } from './CcSwitchClient.js'
import type { ModelRole, ProviderIndex } from './CcSwitchClient.js'

/** SDK query 函数的类型 —— 用 type-only import 避免运行时依赖倒置 */
type QueryFn = (params: {
  prompt: string
  options?: Record<string, unknown>
}) => AsyncIterable<unknown>

export interface ClaudeCodeProviderOptions {
  /** cc-switch client —— Q9 */
  ccSwitch: CcSwitchClient
  /** SDK query 函数 —— 测试时可注入 mock;默认用 @anthropic-ai/claude-agent-sdk */
  queryFn?: QueryFn
  /** debug log */
  debug?: boolean
}

/**
 * 从 SDK 的原始 message 提 SdkMessageEnvelope。
 * SDK message 类型多 (40+),我们只关心能产生 AIEvent 的几类:
 *   - system(含 session_id)
 *   - assistant / partial_assistant(text + content blocks)
 *   - result / error
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
      return { kind: 'system', sessionId }
    }
    case 'assistant': {
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
      // subtype: 'success' | 'error_max_turns' | ...
      const subtype = m['subtype'] as string | undefined
      if (subtype === 'error_max_turns') {
        return { kind: 'error', sessionId, errorCode: 'error_max_turns', message: 'max turns reached', recoverable: false }
      }
      return { kind: 'result', sessionId, reason: 'end_turn' }
    }
    case 'error': {
      return {
        kind: 'error',
        sessionId,
        errorCode: (m['error'] as string | undefined) ?? 'sdk_error',
        message: (m['message'] as string | undefined) ?? 'unknown error',
        recoverable: false,
      }
    }
    default:
      return null
  }
}

export function createClaudeCodeProvider(opts: ClaudeCodeProviderOptions): AIProvider {
  const ccSwitch = opts.ccSwitch
  const debug = opts.debug ?? false

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
   * 解析 model —— Q9.1:
   *   1. opts.model 存在? → 查 (providerId, role) → model id
   *   2. 否则 → ProviderIndex.models.main (current provider)
   * 解析失败 → throw (上层决定 fallback 还是 4xx)
   */
  function resolveModel(selection: ModelSelection | undefined): ProviderIndex | undefined {
    if (!selection) {
      const current = ccSwitch.getCurrent()
      if (!current) return undefined
      return current
    }
    const p = ccSwitch.getById(selection.providerId)
    if (!p) return undefined
    const modelId = p.models[selection.role]
    if (!modelId) return undefined
    return p
  }

  /**
   * SdkAdapter:包装 SDK query()。
   * - model 从 opts / current provider 解析;SDK 接受 role 名 或 model id (spike A1/A2 已验证)
   * - cwd 透传;P0 默认 process.cwd()
   * - resume 透传 sdkSessionId (Q3)
   * - abortController 由 signal 包出 (Q8.2)
   */
  const adapter: SdkAdapter = {
    async *runTurn({ prompt, resume, signal }): AsyncIterable<SdkMessageEnvelope> {
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
      const controller = new AbortController()
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason)
        else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
      }
      sdkOptions['abortController'] = controller
      sdkOptions['cwd'] = process.cwd()
      // model 字段:resolve 后拿到 model id 字符串(SDK 接受 model id,见 spike A2)
      sdkOptions['model'] = resolveModelId(ccSwitch) ?? 'sonnet'

      if (debug) {
        console.log(
          `[ClaudeCodeProvider] runTurn model=${sdkOptions['model']} resume=${resume ?? '<none>'} cwd=${sdkOptions['cwd']}`,
        )
      }

      const stream = q({ prompt, options: sdkOptions })
      for await (const raw of stream) {
        const env = toEnvelope(raw)
        if (env) yield env
        // 没识别的 SDK message 也吃掉 —— 不让 raw 漏出去
      }
    },
  }

  return {
    name: 'claude-code',

    async createSession(reqId: string, createOpts: CreateSessionOptions): Promise<IAISession> {
      const localSid = randomUUID()
      if (debug) {
        console.log(
          `[ClaudeCodeProvider] createSession reqId=${reqId} localSid=${localSid} kind=${createOpts.kind}`,
        )
      }

      const session = new AiSession({
        id: localSid,
        reqId,
        topic: createOpts.topic,
        kind: createOpts.kind,
        adapter,
        resolveModel: () => createOpts.model,
        signal: createOpts.signal,
        debug,
      })

      return session
    },

    async shutdown(): Promise<void> {
      // SDK 是无状态的(query() 即用即走);这里只是清缓存,真正释放由 GC
      cachedQuery = null
    },
  }
}

/**
 * 解析 model id:Q9.1 ——
 *   1. (无 selection) → current provider.models.main
 *   2. (有 selection) → (providerId, role) → model id
 * 失败 → 返回 null(让 SDK 自己默认)
 */
function resolveModelId(ccSwitch: CcSwitchClient): string | null {
  const current = ccSwitch.getCurrent()
  if (!current) return null
  return current.models.main ?? null
}

/** 类型辅助 —— 重导出供 route 直接消费 */
export type { ModelRole, ProviderIndex }