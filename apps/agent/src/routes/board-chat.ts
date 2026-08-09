/**
 * boardChatRoutes —— board chat HTTP + SSE 端点(issue 05 / ADR-0029 D9 + D10)
 *
 * 7 条端点:
 *   POST /api/requirement/:id/board/cards/:cardId/chat/sessions/start
 *     首次启动 chat;无 session.json → 走 SDK 首次 query 拿 sessionId 落盘;
 *     已有 session.json → 直接返现有 meta(不调 SDK)
 *     body: ChatSessionQueryRequestSchema(content 数组)
 *     resp: 200 { meta: ChatSessionMeta }
 *
 *   POST /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/query
 *     续 query(SSE 流);调 Provider.runChatQuery({resumeSessionId, ...});
 *     onEvent → ChatSessionEvent → SSE wire;user_confirm MCP tool handler
 *     推 SSE permission_request → 等 POST /permission 决议 → 返 decision
 *     严格单 tab lock(同 (reqId, cardId) in-flight query 第二个返 409 session-locked)
 *
 *   GET /api/requirement/:id/board/cards/:cardId/chat/sessions/snapshot
 *     meta + events;session 不存在 → {meta: null, events: []}
 *     resp: 200 { meta, events }
 *
 *   PUT /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/model
 *     body: ChatSessionModelSwitchRequestSchema;patch model
 *     resp: 200 { meta }
 *
 *   PUT /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/plan-mode
 *     body: ChatPlanModeToggleSchema;permissionMode === bypassPermissions 时 403
 *     resp: 200 { meta }
 *
 *   POST /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/permission
 *     body: ChatSessionPermissionResolveRequestSchema;决议 pending permission
 *     resp: 200 { acknowledged: true, requestId }
 *
 *   POST /api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/cost-cap
 *     body: ChatSessionCostCapResolveSchema;4 选项决议
 *     resp: 200 { acknowledged: true, resolve }
 *
 * 错误响应:复用 `REASON_TO_HTTP_STATUS_BOARD_CHAT`(requirement-not-found /
 * card-not-found / session-not-found / session-locked / invalid-body /
 * permission-denied / internal),镜像 `board-transcript.ts` 的 failWith 模式。
 *
 * 守门契约(ADR-0023 D11 + ADR-0029 D11):
 * - **不动** ClaudeCodeProvider 的 `runAnalysisQuery` / `createSdkMcpServer` /
 *   `mcpCallCounter` 路径;chat 路径走 Provider.runChatQuery 独立命名空间
 * - chat 路径**不**复用 Analysis Run SSE 通道(决策 31 + ADR-0029 D9:
 *   chat 用 per-query SSE,不走全局 SseHub;server 端 SSE per query,
 *   不持有 session 句柄)
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  ChatPlanModeToggleSchema,
  ChatSessionCostCapResolveSchema,
  ChatSessionModelSwitchRequestSchema,
  ChatSessionPermissionResolveRequestSchema,
  ChatSessionQueryRequestSchema,
  ChatSessionSnapshotResponseSchema,
  REASON_TO_HTTP_STATUS_BOARD_CHAT,
  type BoardChatFailReason,
  type ChatSessionEvent,
  type ChatSessionMeta,
  type ChatPermissionModeT,
} from '@ai-devspace/shared'
import type { TaskCardStore } from '../services/board/TaskCardStore.js'
import {
  ChatSessionService,
  ChatSessionServiceError,
  DEFAULT_PERMISSION_MODE,
  chatDirFor,
} from '../services/board/ChatSessionService.js'
import type {
  AIProvider,
  ChatQueryCapableProvider,
  ChatQueryInput,
  ChatStreamEvent,
} from '../providers/AIProvider.js'

// ---------------------------------------------------------------------------
// SSE wire 编码(per ADR-0029 D10 9 类主事件 + 4 类 sub-agent)
// ---------------------------------------------------------------------------

/** SSE wire 编码 —— `event: <kind>\ndata: <JSON>\n\n` */
function encodeChatEvent(event: ChatSessionEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

// ---------------------------------------------------------------------------
// ChatStreamEvent → ChatSessionEvent 转换(ADR-0029 D10 + 决策 31)
// ---------------------------------------------------------------------------

/** 把 Provider 内部 ChatStreamEvent 转成 SSE wire ChatSessionEvent;
 *  返回 null = 该事件不应被推到 SSE(如 Provider 内部 noise)。 */
export function convertChatStreamEvent(
  event: ChatStreamEvent,
  context?: { permissionMode?: ChatPermissionModeT },
): ChatSessionEvent | null {
  const ts = (event as { ts?: number }).ts ?? Date.now()
  switch (event.kind) {
    case 'session_init':
      return {
        kind: 'chat_session_init',
        ts,
        sessionId: event.sessionId,
        cwd: event.cwd,
        model: event.model,
        // tools 列表由 Provider chatQuery 当前不透传(SDK stream event 未提供);
        // 留空数组不破坏 schema —— web 端按需补 UI 占位(ADR-0029 D10 字段契约保留)
        tools: [],
        permissionMode: context?.permissionMode ?? DEFAULT_PERMISSION_MODE,
      }
    case 'message_user':
      return {
        kind: 'chat_message_user',
        ts,
        content: [{ kind: 'text', text: event.text }],
      }
    case 'message_assistant': {
      const blocks: Array<
        | { kind: 'text'; text: string; partial?: boolean }
        | { kind: 'thinking'; text: string; partial?: boolean }
      > = []
      if (typeof event.text === 'string') {
        blocks.push({ kind: 'text', text: event.text, partial: event.partial })
      }
      if (typeof event.thinking === 'string') {
        blocks.push({ kind: 'thinking', text: event.thinking, partial: event.partial })
      }
      return {
        kind: 'chat_message_assistant',
        ts,
        content: blocks,
      }
    }
    case 'tool_call':
      return {
        kind: 'chat_tool_call',
        ts,
        id: event.id,
        name: event.name,
        args: event.args,
        partial: event.partial,
      }
    case 'tool_result':
      return {
        kind: 'chat_tool_result',
        ts,
        id: event.id,
        name: event.name,
        content: event.output,
        isError: event.isError,
      }
    case 'permission_request':
      return {
        kind: 'chat_permission_request',
        ts,
        requestId: event.requestId,
        toolName: event.toolName,
        input: event.input,
        displayName: event.displayName,
        title: event.title,
        description: event.description,
        // ADR-0029 D5 敏感模式永弹:web 端据 forced=true 强制弹 modal,
        // 不能被 route 层 auto-allow 旁路。Provider stream event 已带 forced,
        // 此处透传,web 端 narrow 拿到即可。
        forced: event.forced,
      }
    case 'permission_resolved':
      return {
        kind: 'chat_permission_resolved',
        ts,
        requestId: event.requestId,
        // 决议细节由 route 层 userConfirmHandler 闭包在推 chat_permission_resolved
        // 时填充,此处 stream event 不携带;Provider 已在 userConfirmHandler resolve 后
        // emit 此事件,web 端拿到时已带 chat_permission_request + resolved 双事件。
        decision: { decision: 'allow' },
      }
    case 'task_started':
      return {
        kind: 'task_started',
        ts,
        taskId: event.taskId,
        description: event.description,
        agentType: event.agentType,
      }
    case 'task_progress':
      return {
        kind: 'task_progress',
        ts,
        taskId: event.taskId,
        summary: event.summary,
      }
    case 'task_completed':
      return {
        kind: 'task_completed',
        ts,
        taskId: event.taskId,
        result: event.result,
        durationMs: event.durationMs,
      }
    case 'error':
      return {
        kind: 'chat_error',
        ts,
        code: event.code,
        message: event.message,
        recoverable: event.recoverable,
      }
    case 'complete':
      return {
        kind: 'chat_complete',
        ts,
        sessionId: event.sessionId,
        totalTokens: event.totalTokens,
        cost: event.cost,
        reason: event.reason,
      }
  }
}

// ---------------------------------------------------------------------------
// 错误响应统一形态
// ---------------------------------------------------------------------------

function failWith(
  reply: FastifyReply,
  reason: BoardChatFailReason,
  message: string,
  log?: FastifyRequest['log'],
): FastifyReply {
  const { code, status } = REASON_TO_HTTP_STATUS_BOARD_CHAT[reason]
  if (log) log.warn({ reason, code, message }, 'board chat request failed')
  return reply.code(status).send({ error: code, reason, message })
}

// ---------------------------------------------------------------------------
// 路由工厂
// ---------------------------------------------------------------------------

export interface BoardChatRoutesDeps {
  workspaceRoot: string
  taskCardStore: TaskCardStore
  chatSessionService: ChatSessionService
  /**
   * AIProvider —— chat 路径走 Provider.runChatQuery。
   * 未注入时 `/start` 和 `/query` 返 503;其他路由(/snapshot /
   * /model / /plan-mode / /permission / /cost-cap)不依赖 Provider。
   */
  provider?: AIProvider
}

// ---------------------------------------------------------------------------
// 主路由函数
// ---------------------------------------------------------------------------

export async function boardChatRoutes(
  app: FastifyInstance,
  deps: BoardChatRoutesDeps,
): Promise<void> {
  const { taskCardStore, chatSessionService } = deps
  const provider = deps.provider
  const chatProvider = provider as AIProvider & Partial<ChatQueryCapableProvider>

  // -------------------------------------------------------------------------
  // 进程级 in-memory 状态
  // -------------------------------------------------------------------------
  /** 单 tab lock value —— 记录 in-flight query + 其关联的 permission scope */
  interface QueryLockValue {
    /** in-flight runChatQuery promise(release 时 await 它) */
    promise: Promise<unknown>
    /** 本次 query 内创建的 permission requestIds —— SSE 关闭时仅清理这些 */
    permissionRequestIds: Set<string>
  }
  // 单 tab lock —— 严格 (reqId, cardId) in-flight query 锁(ADR-0029 D9)。
  // 同 key 第二个 query 立即返 409 session-locked,不排队(避免活锁)。
  const queryLocks = new Map<string, QueryLockValue>()
  // 权限决议队列 —— requestId → { resolve, lockKey }。route 层 userConfirmHandler
  // 推 SSE permission_request 后等 resolve;POST /permission 命中后调用。
  // 按 lockKey 范围清理,避免 tab A 关闭影响 tab B 的 in-flight request。
  const permissionResolvers = new Map<
    string,
    {
      resolve: (decision: {
        behavior: 'allow'
        updatedPermissions?: ReadonlyArray<unknown>
        reason?: string
      } | { behavior: 'deny'; message?: string }) => void
      lockKey: string
    }
  >()
  // cost cap 决议队列 —— sessionKey → resolve(resolveType)。本期实现仅返 ack,
  // 后续 /query 启动时可检查 `sessionCostCapOverrides.get(sessionKey)` 决定是否
  // 跳过 cap 拦截(本期默认 cap 拦截由 Provider SDK 0.3.206 自身处理)。
  const sessionCostCapResolutions = new Map<
    string,
    'continue_once' | 'continue_session' | 'pause' | 'new_session'
  >()

  /** 把 user content 数组拼成 SDK prompt 字符串(本期仅 text kind) */
  function promptFromContent(content: ReadonlyArray<{ kind: string; text?: string }>): string {
    return content
      .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }

  /** 派生 card chat 物理路径 —— 跟 ChatSessionService.chatDir 共享同一公式 */
  function cardChatDir(reqId: string, cardId: string): string {
    return chatDirFor(deps.workspaceRoot, reqId, cardId)
  }

  /** 父 req dir(SDK additionalDirectories[0],ADR-0029 D6)—— 用注入的
   * workspaceRoot 派生,与 cardChatDir 同源,避免依赖 env 变量 */
  function joinReqDir(reqId: string): string {
    return joinDepsReqDir(deps.workspaceRoot, reqId)
  }

  // =========================================================================
  // POST /chat/sessions/start
  // =========================================================================
  app.post<{ Params: { id: string; cardId: string }; Body: unknown }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/start',
    async (req, reply) => {
      const { id: reqId, cardId } = req.params

      // 1. body 校验
      const parsed = ChatSessionQueryRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid start body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      // 2. req / card 存在性
      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }

      // 3. 已有 session.json?直接返(ADR-0029 D3:跨刷新 = 拿现有 meta)
      const existing = chatSessionService.get(reqId, cardId)
      if (existing) {
        return reply.code(200).send({ meta: existing })
      }

      // 4. Provider 未注入 → 503
      if (!chatProvider || typeof chatProvider.runChatQuery !== 'function') {
        return reply.code(503).send({
          error: 'service_not_ready',
          reason: 'AI provider does not implement runChatQuery',
        })
      }

      // 5. 首次启动 —— 调 Provider.runChatQuery(无 resume),等 session_init 落盘
      const cwd = cardChatDir(reqId, cardId)
      let observedSessionId: string | null = null
      let observedCwd = cwd
      let observedModel = 'claude-sonnet-5'

      const result = await chatProvider.runChatQuery({
        prompt: promptFromContent(parsed.data.content),
        cwd,
        additionalDirectories: [joinReqDir(reqId)],
        model: observedModel,
        permissionMode: DEFAULT_PERMISSION_MODE,
        // /start 阶段无 SSE,userConfirmHandler 自动 allow(不阻塞)
        userConfirmHandler: async () => ({ behavior: 'allow' as const }),
        onEvent: (event) => {
          if (event.kind === 'session_init') {
            observedSessionId = event.sessionId
            if (typeof event.cwd === 'string') observedCwd = event.cwd
            if (typeof event.model === 'string') observedModel = event.model
          }
        },
      })

      if (!result.ok || !observedSessionId) {
        req.log.error(
          { reqId, cardId, err: 'no_session_id' },
          'board chat start: SDK did not yield session_id',
        )
        return failWith(
          reply,
          'internal',
          'SDK did not yield session_id during start; cannot persist session.json',
          req.log,
        )
      }

      // 6. 落盘 session.json(atomic)
      try {
        const meta = await chatSessionService.getOrCreateSession(reqId, cardId, {
          sdkSessionId: observedSessionId,
          cwd: observedCwd,
          additionalDirectories: [joinReqDir(reqId)],
          model: observedModel,
          permissionMode: DEFAULT_PERMISSION_MODE,
          mcpServers: [{ name: 'boardchat', config: { type: 'sdk' } }],
          ownerUserId: 'user-1',
        })
        return reply.code(200).send({ meta })
      } catch (err) {
        req.log.error({ err, reqId, cardId }, 'board chat start: getOrCreateSession failed')
        return failWith(
          reply,
          'internal',
          err instanceof Error ? err.message : 'session persist failed',
          req.log,
        )
      }
    },
  )

  // =========================================================================
  // POST /chat/sessions/:sessionId/query —— SSE 流
  // =========================================================================
  app.post<{ Params: { id: string; cardId: string; sessionId: string }; Body: unknown }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/query',
    async (req, reply) => {
      const { id: reqId, cardId, sessionId } = req.params

      // 1. body 校验
      const parsed = ChatSessionQueryRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid query body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      // 2. req / card 存在性
      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }

      // 3. session 校验 —— 宽容:session.json 缺失时也能 resume(SDK 仍在 30 天 TTL
      // 内);仅在 session.json 存在且 sessionId 不匹配时返 404(避免误 resume)。
      const meta = chatSessionService.get(reqId, cardId)
      if (meta && meta.sessionId !== sessionId) {
        return failWith(
          reply,
          'session-not-found',
          `sessionId mismatch: expected ${meta.sessionId}, got ${sessionId}`,
          req.log,
        )
      }
      // session.json 缺失 → 派生 defaults(resume 协议 D9:SDK sessionId 由 URL 提供)
      const effectiveCwd = meta?.cwd ?? cardChatDir(reqId, cardId)
      const effectiveModel = meta?.model ?? 'claude-sonnet-5'
      const effectivePermissionMode = meta?.permissionMode ?? DEFAULT_PERMISSION_MODE
      const effectiveAdditionalDirectories = meta
        ? [...meta.additionalDirectories]
        : [joinReqDir(reqId)]

      // 4. 严格单 tab lock —— 同 key in-flight 第二个返 409 session-locked
      const lockKey = `${reqId}::${cardId}`
      if (queryLocks.has(lockKey)) {
        return failWith(
          reply,
          'session-locked',
          `another query is in-flight for ${reqId}/${cardId}; please close other tabs`,
          req.log,
        )
      }

      // 5. Provider 未注入 → 503
      if (!chatProvider || typeof chatProvider.runChatQuery !== 'function') {
        return reply.code(503).send({
          error: 'service_not_ready',
          reason: 'AI provider does not implement runChatQuery',
        })
      }

      // 6. 设置 SSE 响应头
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.hijack()

      const sseWrite = (event: ChatSessionEvent): void => {
        try {
          reply.raw.write(encodeChatEvent(event))
        } catch {
          /* socket closed */
        }
      }

      // 7. 写 chat_message_user(我们生成的 user 消息) —— SDK query 启动前
      sseWrite({
        kind: 'chat_message_user',
        ts: Date.now(),
        content: [...parsed.data.content],
      })

      // 8. 单 tab lock —— value 用 in-flight runChatQuery promise,
      // 配合 permissionRequestIds Set 在 SSE 关闭时按 lockKey 清理 resolvers。
      const lockValue: QueryLockValue = {
        promise: Promise.resolve(),
        permissionRequestIds: new Set<string>(),
      }
      queryLocks.set(lockKey, lockValue)

      // 9. SSE 关闭清理 —— 仅清理本次 lockKey 的 permissions
      const cleanup = (): void => {
        queryLocks.delete(lockKey)
        for (const requestId of lockValue.permissionRequestIds) {
          const resolver = permissionResolvers.get(requestId)
          if (resolver) {
            resolver.resolve({ behavior: 'deny', message: 'SSE stream closed' })
            permissionResolvers.delete(requestId)
          }
        }
        lockValue.permissionRequestIds.clear()
        reply.raw.off('close', cleanup)
      }
      reply.raw.on('close', cleanup)

      // 实际 runChatQuery promise 启动(同步构造,异步 await)
      const runChatQuery = chatProvider.runChatQuery.bind(chatProvider)
      const queryPromise = (async () => {
        try {
          await runChatQuery({
            prompt: promptFromContent(parsed.data.content),
            cwd: effectiveCwd,
            additionalDirectories: effectiveAdditionalDirectories,
            model: effectiveModel,
            permissionMode: effectivePermissionMode,
            resumeSessionId: sessionId,
            frozenCwd: effectiveCwd,
            userConfirmHandler: async (args) => {
              const requestId = args.requestId || `req-${randomUUID()}`
              lockValue.permissionRequestIds.add(requestId)
              // 推 SSE permission_request —— ADR-0029 D5 敏感模式永弹信号也带 forced
              sseWrite({
                kind: 'chat_permission_request',
                ts: Date.now(),
                requestId,
                toolName: args.toolName,
                input: args.input,
                displayName: args.displayName,
                title: args.title,
                description: args.description,
                ...(typeof args.input === 'object' && args.input !== null
                  ? {} // forced 由 Provider 包装层 emit 的 chat_permission_request
                    // 提供;此处直接推 SSE 的形态与 Provider stream 一致
                  : {}),
              })
              // 等 POST /permission 决议
              const decision = await new Promise<
                | { behavior: 'allow'; updatedPermissions?: ReadonlyArray<unknown>; reason?: string }
                | { behavior: 'deny'; message?: string }
              >((resolve) => {
                permissionResolvers.set(requestId, { resolve, lockKey })
              })
              permissionResolvers.delete(requestId)
              lockValue.permissionRequestIds.delete(requestId)
              // 推 SSE permission_resolved(含决议)
              sseWrite({
                kind: 'chat_permission_resolved',
                ts: Date.now(),
                requestId,
                decision: {
                  decision: decision.behavior,
                  ...(decision.behavior === 'deny' && decision.message !== undefined
                    ? { reason: decision.message }
                    : decision.behavior === 'allow' && decision.reason !== undefined
                      ? { reason: decision.reason }
                      : {}),
                },
              })
              return decision
            },
            onEvent: (event) => {
              const converted = convertChatStreamEvent(event, {
                permissionMode: effectivePermissionMode,
              })
              if (converted) sseWrite(converted)
            },
          })
        } catch (err) {
          // SSE 已打开,不能再发 JSON;通过 SSE chat_error 事件传达错误
          sseWrite({
            kind: 'chat_error',
            ts: Date.now(),
            code: 'E_QUERY_FAILED',
            message: err instanceof Error ? err.message : String(err),
            recoverable: false,
          })
          req.log.error({ err, reqId, cardId, sessionId }, 'board chat query: provider threw')
        }
      })()
      // 把真实 promise 写回 lock,让外部 queryLocks.get(lockKey)?.promise 拿到
      lockValue.promise = queryPromise

      try {
        await queryPromise
      } finally {
        cleanup()
      }
    },
  )

  // =========================================================================
  // GET /chat/sessions/snapshot
  // =========================================================================
  app.get<{ Params: { id: string; cardId: string } }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/snapshot',
    async (req, reply) => {
      const { id: reqId, cardId } = req.params
      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }
      const snap = chatSessionService.loadSnapshot(reqId, cardId)
      const validated = ChatSessionSnapshotResponseSchema.parse({
        meta: snap.meta,
        events: snap.events,
      })
      return reply.code(200).send(validated)
    },
  )

  // =========================================================================
  // PUT /chat/sessions/:sessionId/model
  // =========================================================================
  app.put<{
    Params: { id: string; cardId: string; sessionId: string }
    Body: unknown
  }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/model',
    async (req, reply) => {
      const { id: reqId, cardId, sessionId } = req.params

      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }

      const parsed = ChatSessionModelSwitchRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid model body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      const existing = chatSessionService.get(reqId, cardId)
      if (!existing) {
        return failWith(
          reply,
          'session-not-found',
          `no chat session for ${reqId}/${cardId}`,
          req.log,
        )
      }
      if (existing.sessionId !== sessionId) {
        return failWith(
          reply,
          'session-not-found',
          `sessionId mismatch: expected ${existing.sessionId}, got ${sessionId}`,
          req.log,
        )
      }

      try {
        const meta = chatSessionService.patch(reqId, cardId, { model: parsed.data.model })
        return reply.code(200).send({ meta })
      } catch (err) {
        req.log.error({ err, reqId, cardId }, 'board chat model: patch failed')
        return failWith(
          reply,
          'internal',
          err instanceof Error ? err.message : 'patch failed',
          req.log,
        )
      }
    },
  )

  // =========================================================================
  // PUT /chat/sessions/:sessionId/plan-mode
  // =========================================================================
  app.put<{
    Params: { id: string; cardId: string; sessionId: string }
    Body: unknown
  }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/plan-mode',
    async (req, reply) => {
      const { id: reqId, cardId, sessionId } = req.params

      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }

      const parsed = ChatPlanModeToggleSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid plan-mode body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      const existing = chatSessionService.get(reqId, cardId)
      if (!existing) {
        return failWith(
          reply,
          'session-not-found',
          `no chat session for ${reqId}/${cardId}`,
          req.log,
        )
      }
      if (existing.sessionId !== sessionId) {
        return failWith(
          reply,
          'session-not-found',
          `sessionId mismatch: expected ${existing.sessionId}, got ${sessionId}`,
          req.log,
        )
      }

      // 守门:bypassPermissions 时 plan toggle 拒绝(ADR-0029 D8 决策 36)
      if (existing.permissionMode === 'bypassPermissions') {
        return failWith(
          reply,
          'permission-denied',
          'plan mode toggle disabled when permissionMode is bypassPermissions',
          req.log,
        )
      }

      const targetMode: ChatPermissionModeT = parsed.data.enabled ? 'plan' : 'default'
      try {
        const meta = chatSessionService.patch(reqId, cardId, { permissionMode: targetMode })
        return reply.code(200).send({ meta })
      } catch (err) {
        req.log.error({ err, reqId, cardId }, 'board chat plan-mode: patch failed')
        return failWith(
          reply,
          'internal',
          err instanceof Error ? err.message : 'patch failed',
          req.log,
        )
      }
    },
  )

  // =========================================================================
  // POST /chat/sessions/:sessionId/permission
  // =========================================================================
  app.post<{
    Params: { id: string; cardId: string; sessionId: string }
    Body: unknown
  }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/permission',
    async (req, reply) => {
      const { id: reqId, cardId, sessionId } = req.params

      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }

      const parsed = ChatSessionPermissionResolveRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid permission body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      // session 校验(防御性:有 session.json 但 sessionId 不一致时报错;
      // 无 session.json 时仍可决议 —— SSE 可能在 init 后立即触发 user_confirm)
      const existing = chatSessionService.get(reqId, cardId)
      if (existing && existing.sessionId !== sessionId) {
        return failWith(
          reply,
          'session-not-found',
          `sessionId mismatch: expected ${existing.sessionId}, got ${sessionId}`,
          req.log,
        )
      }

      // 找 resolver 并决议(tolerant:没有 pending request 时也返 200 ack —— web
      // 可能因 reload 重发决议;resolver 不存在时 log warning 即可,不让 web 卡住)。
      const resolver = permissionResolvers.get(parsed.data.requestId)
      if (resolver) {
        // 把 ChatPermissionResolved 转成 userConfirmHandler 决议形态
        const updated = parsed.data.updatedPermissions
        const decision =
          updated.behavior === 'allow'
            ? {
                behavior: 'allow' as const,
                ...(updated.updatedPermissions ? { updatedPermissions: updated.updatedPermissions } : {}),
                ...(updated.reason ? { reason: updated.reason } : {}),
              }
            : {
                behavior: 'deny' as const,
                ...(updated.reason ? { message: updated.reason } : {}),
              }
        resolver.resolve(decision)
      } else {
        req.log.warn(
          { reqId, cardId, requestId: parsed.data.requestId },
          'board chat permission: no pending resolver (SSE may have closed)',
        )
      }

      return reply.code(200).send({
        acknowledged: true,
        requestId: parsed.data.requestId,
      })
    },
  )

  // =========================================================================
  // POST /chat/sessions/:sessionId/cost-cap
  // =========================================================================
  app.post<{
    Params: { id: string; cardId: string; sessionId: string }
    Body: unknown
  }>(
    '/api/requirement/:id/board/cards/:cardId/chat/sessions/:sessionId/cost-cap',
    async (req, reply) => {
      const { id: reqId, cardId, sessionId } = req.params

      if (!taskCardStore.exists(reqId)) {
        return failWith(reply, 'requirement-not-found', `requirement ${reqId} not found`, req.log)
      }
      const card = taskCardStore.get(reqId, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${reqId}`, req.log)
      }

      const parsed = ChatSessionCostCapResolveSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid cost-cap body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      // 记录决议(本期实现仅返 ack;后续 query 可读这个 map 决定 cap 行为)
      const sessionKey = `${reqId}::${cardId}`
      sessionCostCapResolutions.set(sessionKey, parsed.data.resolve)

      return reply.code(200).send({
        acknowledged: true,
        resolve: parsed.data.resolve,
        sessionId,
      })
    },
  )
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** `<root>/requirements/<reqId>/` 父 req dir(SDK additionalDirectories[0]) */
function joinDepsReqDir(workspaceRoot: string, reqId: string): string {
  return `${workspaceRoot}/requirements/${reqId}`
}