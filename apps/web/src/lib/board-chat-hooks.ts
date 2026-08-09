/**
 * board chat React Query hooks(issue 07 / ADR-0029 D4 + D8 + D9 + D10)
 *
 * 提供:
 * - `useChatSessionSnapshot(reqId, cardId)` —— GET snapshot 渲染历史
 * - `useChatSessionStream(reqId, cardId, meta)` —— POST /query 起 SSE 流,
 *   累计 ChatSessionEvent 数组;send(input) 触发新 query,events 自动 append
 * - `useChatSessionLock(reqId, cardId)` —— 探测 in-flight query lock(同
 *   (reqId, cardId) 只能 1 个 in-flight;第二个 tab 拿不到则显示 banner)
 * - `useChatSessionStart(reqId, cardId)` —— POST /start(无 session 时)
 * - `useChatQuery(...)` —— 包含 SSE 连接的 mutation(由 stream hook 内部调)
 * - `useChatPermission(reqId, cardId, sessionId)` —— POST /permission 决议
 * - `useChatModelSwitch(...)` —— PUT /model
 * - `useChatPlanMode(...)` —— PUT /plan-mode
 * - `useChatCostCap(...)` —— POST /cost-cap
 *
 * SSE 实现要点:
 * - POST /query 是 streaming response(SSR / SSE);EventSource 仅 GET,
 *   故用 fetch + ReadableStream 解析 `event: <kind>\ndata: <json>\n\n`
 * - 跨域 cookie 由 agent-bootstrap 同源 cookie 共享处理(`credentials: 'include'`)
 * - 每条 event 走 `ChatSessionEventSchema.safeParse` 校验,失败 log warning 但不 throw
 *
 * 单 tab lock:
 * - 通过 stream hook 内部监听 409 session-locked → 写 ref 状态给 UI 用
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChatSessionEventSchema,
  ChatSessionSnapshotResponseSchema,
  type ChatDecisionWithReason,
  type ChatPermissionResolved,
  type ChatSessionEvent,
  type ChatSessionMeta,
  type ChatSessionModelSwitchRequest,
  type ChatSessionPermissionResolveRequest,
  type ChatSessionSnapshotResponse,
  type ChatPlanModeToggle,
  type ChatSessionCostCapResolve,
} from '@ai-devspace/shared'
import { AgentError, agentFetch } from './agent-client'

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * GET `/api/requirement/:id/board/cards/:cardId/chat/sessions/snapshot` —— 渲染历史
 * + session meta。
 *
 * 注:`staleTime: 0` —— 每次进 detail page 都要拿最新;新 query 后 stream hook
 * 会 invalidate 该 query 让 UI 重拉(snapshot 含累计 cost 等元数据更新)。
 */
export function useChatSessionSnapshot(requirementId: string, cardId: string) {
  const query = useQuery({
    queryKey: ['board-chat-snapshot', requirementId, cardId] as const,
    async queryFn() {
      const res = await agentFetch<unknown>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/snapshot`,
      )
      return ChatSessionSnapshotResponseSchema.parse(res)
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return {
    snapshot: (query.data ?? null) as ChatSessionSnapshotResponse | null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// SSE 流(stream hook)
// ---------------------------------------------------------------------------

export interface UseChatSessionStreamInput {
  content: string
  /** 本次 query 关联的 cardId —— 用于底层 URL 构造。 */
  cardId: string
}

export type ChatStreamStatus = 'idle' | 'streaming' | 'locked' | 'error' | 'closed'

export interface UseChatSessionStreamResult {
  events: ChatSessionEvent[]
  status: ChatStreamStatus
  error: string | null
  /** 最后一个未决议的 permission request(供 UI 弹 modal)。 */
  pendingPermission: Extract<
    ChatSessionEvent,
    { kind: 'chat_permission_request' }
  > | null
  /** 是否到达 cost cap(供 UI 弹 CostCapModal)。 */
  pendingCostCap: boolean
  /** 触发新 query(POST .../query SSE)。 */
  send: (input: UseChatSessionStreamInput) => Promise<void>
  /** 中断 in-flight SSE 连接。 */
  abort: () => void
}

/**
 * POST `/chat/sessions/:sessionId/query` 起的 SSE 流 hook。
 *
 * 设计要点:
 * - 走 `fetch` + `ReadableStream` 逐行解析 SSE(POST 不支持 EventSource)
 * - `send()` 启新 promise;连续 send 会 abort 旧的(stream hook 内部状态)
 * - 累计 events 在 React state 里;UI 通过 `pendingPermission` 读未决议的
 *   permission request;`pendingCostCap` 由 chat_complete(累计 cost > $5)推导
 * - 顶层 hooks(useChatPermission / useChatModelSwitch / ...)调完后再
 *   invalidate snapshot 拿新 meta
 */
export function useChatSessionStream(
  requirementId: string,
  cardId: string,
  meta: ChatSessionMeta | null,
): UseChatSessionStreamResult {
  const [events, setEvents] = useState<ChatSessionEvent[]>([])
  const [status, setStatus] = useState<ChatStreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pendingResolveRef = useRef<((v: void) => void) | null>(null)

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    pendingResolveRef.current?.()
    pendingResolveRef.current = null
    setStatus('closed')
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const send = useCallback(
    async (input: UseChatSessionStreamInput): Promise<void> => {
      if (!meta) {
        // 没有 session → 提示调用方先 /start
        setError('no chat session; call useChatSessionStart first')
        setStatus('error')
        return
      }
      // abort 旧的
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setError(null)
      setStatus('streaming')

      return new Promise<void>((resolve) => {
        pendingResolveRef.current = resolve
        void runChatQueryStream({
          requirementId,
          cardId,
          sessionId: meta.sessionId,
          content: input.content,
          signal: ctrl.signal,
          onEvent: (event) => {
            setEvents((prev) => [...prev, event])
          },
          onError: (msg) => {
            setError(msg)
            setStatus('error')
          },
          onDone: () => {
            setStatus('closed')
            pendingResolveRef.current = null
            resolve()
          },
          onLocked: () => {
            setStatus('locked')
            pendingResolveRef.current = null
            resolve()
          },
        })
      })
    },
    [requirementId, cardId, meta],
  )

  // 派生:last permission_request 且无对应 permission_resolved → pending
  const pendingPermission = useMemo(() => {
    let last: Extract<ChatSessionEvent, { kind: 'chat_permission_request' }> | null =
      null
    for (const ev of events) {
      if (ev.kind === 'chat_permission_request') {
        last = ev
      } else if (ev.kind === 'chat_permission_resolved' && last) {
        if (ev.requestId === last.requestId) last = null
      }
    }
    return last
  }, [events])

  // 派生:累计 cost >= 5 → pendingCostCap
  const pendingCostCap = useMemo(() => {
    if (!meta) return false
    return meta.cumulativeUsage.cumulativeCostUsd >= 5
  }, [meta])

  return { events, status, error, pendingPermission, pendingCostCap, send, abort }
}

// ---------------------------------------------------------------------------
// SSE stream runner(POST + ReadableStream 解析)
// ---------------------------------------------------------------------------

interface RunStreamOpts {
  requirementId: string
  cardId: string
  sessionId: string
  content: string
  signal: AbortSignal
  onEvent: (event: ChatSessionEvent) => void
  onError: (msg: string) => void
  onDone: () => void
  onLocked: () => void
}

async function runChatQueryStream(opts: RunStreamOpts): Promise<void> {
  const { requirementId, cardId, sessionId, content, signal } = opts
  let res: Response
  try {
    res = await fetch(
      `${getAgentBase()}/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/${encodeURIComponent(sessionId)}/query`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          content: [{ kind: 'text', text: content }],
        }),
        signal,
      },
    )
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      opts.onDone()
      return
    }
    opts.onError(err instanceof Error ? err.message : String(err))
    return
  }

  if (res.status === 409) {
    opts.onLocked()
    return
  }
  if (!res.ok || !res.body) {
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      /* ignore */
    }
    opts.onError(`HTTP ${res.status}: ${bodyText || 'request failed'}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = 'message'
  let dataLines: string[] = []

  const dispatch = (): void => {
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    dataLines = []
    try {
      const parsed = JSON.parse(data) as unknown
      const result = ChatSessionEventSchema.safeParse(parsed)
      if (result.success) {
        opts.onEvent(result.data)
        if (result.data.kind === 'chat_complete') {
          opts.onDone()
        }
      } else {
        // unknown shape —— ignore
      }
    } catch {
      /* not JSON — ignore */
    }
    currentEvent = 'message'
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        // final flush
        if (buffer.length > 0) {
          for (const line of buffer.split('\n')) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice('event:'.length).trim()
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice('data:'.length).trim())
            } else if (line === '') {
              dispatch()
            }
          }
        }
        dispatch()
        opts.onDone()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      let nlIdx = buffer.indexOf('\n')
      while (nlIdx !== -1) {
        const line = buffer.slice(0, nlIdx)
        buffer = buffer.slice(nlIdx + 1)
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim())
        } else if (line === '') {
          dispatch()
        }
        nlIdx = buffer.indexOf('\n')
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      opts.onDone()
      return
    }
    opts.onError(err instanceof Error ? err.message : String(err))
  }
}

function getAgentBase(): string {
  return process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:7777'
}

// ---------------------------------------------------------------------------
// 单 tab lock 探测(GET snapshot 间歇判断 + stream status)
// ---------------------------------------------------------------------------

/**
 * 探测同 `(reqId, cardId)` 是否有其他 tab 在跑 in-flight query。
 *
 * 实现:
 * - 客户端拿 `BroadcastChannel('board-chat-lock')`(同 origin 跨 tab)
 * - 心跳:本 tab 起 stream 时发 `{key, tabId: 'started' | 'finished'}`;
 *   其他 tab 收到 'started' 且 key 匹配 → 设 lockedByOtherTab=true
 * - 'finished' 事件 → 清标志
 *
 * SSR 安全:服务端不挂 BroadcastChannel,初始 lockedByOtherTab=false。
 */
export function useChatSessionLock(
  requirementId: string,
  cardId: string,
  streamStatus: ChatStreamStatus,
): { lockedByOtherTab: boolean } {
  const tabIdRef = useRef<string>(`tab-${Math.random().toString(36).slice(2)}`)
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return
    }
    const key = `${requirementId}::${cardId}`
    const channel = new BroadcastChannel('board-chat-lock')
    const onMessage = (ev: MessageEvent<unknown>): void => {
      const data = ev.data as
        | { type: 'started' | 'finished'; key: string; tabId: string }
        | undefined
      if (!data || data.key !== key) return
      if (data.tabId === tabIdRef.current) return
      if (data.type === 'started') setLockedByOtherTab(true)
      else if (data.type === 'finished') setLockedByOtherTab(false)
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
    }
  }, [requirementId, cardId])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return
    }
    const key = `${requirementId}::${cardId}`
    const channel = new BroadcastChannel('board-chat-lock')
    if (streamStatus === 'streaming') {
      channel.postMessage({ type: 'started', key, tabId: tabIdRef.current })
    } else if (streamStatus === 'closed' || streamStatus === 'idle') {
      channel.postMessage({ type: 'finished', key, tabId: tabIdRef.current })
    }
    return () => {
      channel.postMessage({ type: 'finished', key, tabId: tabIdRef.current })
      channel.close()
    }
  }, [streamStatus, requirementId, cardId])

  return { lockedByOtherTab }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface UseChatSessionStartArgs {
  content: string
}

/**
 * POST `/chat/sessions/start` —— 无 session 时启动 SDK session,落 session.json。
 *
 * 成功后 `result.meta` 含 sessionId,UI 据此建 stream。
 */
export function useChatSessionStart(requirementId: string, cardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: UseChatSessionStartArgs) => {
      const res = await agentFetch<{ meta: ChatSessionMeta }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/start`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: [{ kind: 'text', text: args.content }],
          }),
        },
      )
      return res
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['board-chat-snapshot', requirementId, cardId],
      })
    },
  })
}

/**
 * 把 query mutation 内嵌到 stream hook 后保留别名(向后兼容旧测试 / 上层调用点)。
 */
export function useChatQuery(
  requirementId: string,
  cardId: string,
  meta: ChatSessionMeta | null,
) {
  const stream = useChatSessionStream(requirementId, cardId, meta)
  return {
    mutateAsync: stream.send,
    isPending: stream.status === 'streaming',
  }
}

// ---------------------------------------------------------------------------
// Permission / Model / PlanMode / CostCap mutations
// ---------------------------------------------------------------------------

export interface ResolvePermissionArgs {
  requestId: string
  decision: ChatDecisionWithReason
  updatedPermissions: ChatPermissionResolved
}

export function useChatPermission(
  requirementId: string,
  cardId: string,
  sessionId: string | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: ResolvePermissionArgs) => {
      if (!sessionId) throw new AgentError(0, { reason: 'no-session' })
      const body: ChatSessionPermissionResolveRequest = {
        requestId: args.requestId,
        decision: args.decision,
        updatedPermissions: args.updatedPermissions,
      }
      return agentFetch<{ acknowledged: true; requestId: string }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/${encodeURIComponent(sessionId)}/permission`,
        { method: 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['board-chat-snapshot', requirementId, cardId],
      })
    },
  })
}

export interface SwitchModelArgs extends ChatSessionModelSwitchRequest {}

export function useChatModelSwitch(
  requirementId: string,
  cardId: string,
  sessionId: string | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: SwitchModelArgs) => {
      if (!sessionId) throw new AgentError(0, { reason: 'no-session' })
      return agentFetch<{ meta: ChatSessionMeta }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/${encodeURIComponent(sessionId)}/model`,
        { method: 'PUT', body: JSON.stringify(args) },
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['board-chat-snapshot', requirementId, cardId],
      })
    },
  })
}

export function useChatPlanMode(
  requirementId: string,
  cardId: string,
  sessionId: string | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: ChatPlanModeToggle) => {
      if (!sessionId) throw new AgentError(0, { reason: 'no-session' })
      return agentFetch<{ meta: ChatSessionMeta }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/${encodeURIComponent(sessionId)}/plan-mode`,
        { method: 'PUT', body: JSON.stringify(args) },
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['board-chat-snapshot', requirementId, cardId],
      })
    },
  })
}

export function useChatCostCap(
  requirementId: string,
  cardId: string,
  sessionId: string | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: ChatSessionCostCapResolve) => {
      if (!sessionId) throw new AgentError(0, { reason: 'no-session' })
      return agentFetch<{ acknowledged: true; resolve: ChatSessionCostCapResolve['resolve'] }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/chat/sessions/${encodeURIComponent(sessionId)}/cost-cap`,
        { method: 'POST', body: JSON.stringify(args) },
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['board-chat-snapshot', requirementId, cardId],
      })
    },
  })
}