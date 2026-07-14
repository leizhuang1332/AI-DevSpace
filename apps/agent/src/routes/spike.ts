/**
 * Spike Routes —— ADR-0010 P0 + P4 (typed SSE / 持久化 / 取消)
 *
 * 端点:
 *   - POST /api/spike/run —— 启动 SDK query,把 AIEvent typed 推到订阅者;meta+messages 落盘
 *   - GET  /api/spike/events —— SSE 订阅;订阅时发 hello,接收 typed 流
 *   - POST /api/spike/session/:id/cancel —— 202 + cancel('user');不在 liveSessions → 404
 *
 * 关键不变量:
 *   - meta 先于 createSession 落盘(失败也能拿到 sessionId 做诊断)
 *   - provider.createSession 失败 → publish query_failed typed event,不污染 liveSessions
 *   - AIEvent → typed SseEvent 通过 mapAiEventToSse 转换:
 *       retrying   → SseEvent.retrying
 *       error      → SseEvent.query_failed (category !== 'E')
 *       done{cancelled} → SseEvent.query_cancelled
 *       其他 AIEvent → SseEvent.ai_event(typed envelope)
 */

import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from '../sse/SseHub.js'
import type { AIEvent } from '../providers/AIEvent.js'
import type { AIProvider, AISession } from '../providers/AIProvider.js'
import type { CcSwitchClient } from '../providers/CcSwitchClient.js'
import type { SessionStore } from '../session/SessionStore.js'
import type { MessagesMirror } from '../session/MessagesMirror.js'
import { attachRecorder } from '../session/SessionRecorder.js'
import { attachSessionBroadcaster } from '../sse/sessionBroadcaster.js'
import { mapAiEventToSse } from '../sse/mapAiEventToSse.js'
import type { SessionStateRegistry } from '../session/SessionStateRegistry.js'

// 重新导出保持向后兼容(原 spike.ts 内有此函数,spikeRoutes.test.ts 也直接 import)
export { mapAiEventToSse }

/** P0 阶段固定通道 id;P5 会改成 per-session N 通道 */
export const SPIKE_CHANNEL = 'spike'

export interface SpikeRoutesOptions {
  hub: SseHub
  /** 单例 AIProvider —— Agent 启动时构造一次 */
  provider: AIProvider
  /** 单例 CcSwitchClient —— Agent 启动时构造一次;route 用于打印启动日志 */
  ccSwitch: CcSwitchClient
  /** Q7.1 会话 meta CRUD —— POST /run 时落盘 meta.yaml(失败也能拿 sessionId) */
  store: SessionStore
  /** Q7.4 messages.jsonl 镜像 —— SessionRecorder attach 后异步写 */
  mirror: MessagesMirror
  /** Q10.4 StatusBar 4 指示器状态注册表 —— broadcaster 用它记录 recent_writes */
  registry: SessionStateRegistry
}

interface RunBody {
  prompt?: unknown
  reqId?: unknown
}

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * 把 AIEvent typed 映射成 SseEvent —— 拆到 sse/mapAiEventToSse.ts(打破与
 * sessionBroadcaster 的循环依赖);这里仅 re-export,保持 spikeRoutes.test.ts
 * 里的 import 路径不破。
 */

export const spikeRoutes: FastifyPluginAsync<SpikeRoutesOptions> = async (fastify, opts) => {
  const { hub, provider, ccSwitch, store, mirror, registry } = opts

  // 启动日志 —— issue 验收第 1 条
  const current = ccSwitch.getCurrent()
  if (current) {
    fastify.log.info(
      { provider: current.name, baseUrl: current.baseUrl, models: current.models },
      '[spike] cc-switch current provider',
    )
  } else {
    fastify.log.warn('[spike] no cc-switch claude provider configured')
  }

  // GET /api/spike/events —— SSE 订阅(public: spike 阶段供 curl 直接验证,P5 观测性接 web 时再加 auth)
  fastify.get('/api/spike/events', { config: { public: true } }, async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.hijack()

    const sid = randomUUID()
    const write = (event: SseEvent): void => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      } catch {
        /* socket already closed */
      }
    }

    write({ type: 'hello', sid, reqId: SPIKE_CHANNEL, ts: Date.now() })

    const unsubscribe = hub.subscribe(SPIKE_CHANNEL, write)
    const cleanup = (): void => {
      unsubscribe()
      reply.raw.off('close', cleanup)
    }
    reply.raw.on('close', cleanup)
  })

  // live session registry —— 用于 cancel endpoint 查找
  const liveSessions = new Map<string, AISession>()

  // POST /api/spike/session/:id/cancel —— 命中 live → cancel('user');不在 live → 404
  fastify.post<{ Params: { id: string } }>(
    '/api/spike/session/:id/cancel',
    { config: { public: true } },
    async (req, reply) => {
      const session = liveSessions.get(req.params.id)
      if (!session) {
        return reply.code(404).send({ error: 'session_not_running', sessionId: req.params.id })
      }
      void session.cancel('user')
      return reply.code(202).send({ status: 'cancelling', sessionId: session.id })
    },
  )

  // POST /api/spike/run —— 启动 SDK query(public: 同上,spike 阶段免 auth)
  fastify.post<{ Body: RunBody }>('/api/spike/run', { config: { public: true } }, async (req, reply) => {
    const body = req.body ?? {}
    if (!isNonEmptyString(body.prompt)) {
      return reply.code(400).send(badRequest('prompt is required and must be non-empty'))
    }
    const prompt = body.prompt
    const reqId = isNonEmptyString(body.reqId) ? body.reqId : SPIKE_CHANNEL

    const runId = randomUUID()
    fastify.log.info(
      { runId, reqId, promptPreview: prompt.slice(0, 60) },
      '[spike] /run starting SDK query',
    )

    // 1) 先落 meta(meta.yaml 立即可见,失败也能拿到 sessionId)
    const meta = await store.createSession(reqId, { topic: 'spike', kind: 'chat' })

    // 2) provider.createSession —— 失败 → query_failed typed,不污染 liveSessions
    let session: AISession
    try {
      session = await provider.createSession(reqId, {
        localSid: meta.sid,
        topic: meta.topic,
        kind: meta.kind,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fastify.log.error({ err: error, runId, sessionId: meta.sid }, '[spike] createSession failed')
      hub.publish(reqId, {
        type: 'query_failed',
        runId,
        reqId,
        sessionId: meta.sid,
        ts: Date.now(),
        category: 'B',
        code: 'session_create_failed',
        message,
        retryable: false,
      })
      return reply.code(202).send({
        status: 'accepted',
        runId,
        reqId,
        sessionId: meta.sid,
        promptPreview: prompt.slice(0, 80),
      })
    }

    // 3) live + recorder
    liveSessions.set(session.id, session)
    registry.register(session)
    const recorder = attachRecorder(session, { store, mirror })

    // 4) P5 · Q10.2:per-session broadcaster —— 推到两通道(reqId + sessionId),
    //    并在 session.close() 时清掉该 session 通道的所有订阅者
    const broadcaster = attachSessionBroadcaster(session, reqId, {
      hub,
      registry,
      runId,
      onError: (err) =>
        fastify.log.error({ err, runId, sessionId: session.id }, '[spike] event pump threw'),
    })

    // 5) 异步 run + cleanup
    void (async () => {
      try {
        await session.send(prompt)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        fastify.log.error({ err: error, runId, sessionId: session.id }, '[spike] run failed')
        hub.publish(reqId, {
          type: 'query_failed',
          runId,
          reqId,
          sessionId: session.id,
          ts: Date.now(),
          category: 'B',
          code: 'run_failed',
          message,
          retryable: false,
        })
      } finally {
        try {
          await session.close()
        } catch {
          /* noop */
        }
        await broadcaster.close()
        await recorder.done
        registry.unregister(session.id)
        liveSessions.delete(session.id)
      }
    })()

    return reply.code(202).send({
      status: 'accepted',
      runId,
      reqId,
      sessionId: session.id,
      promptPreview: prompt.slice(0, 80),
    })
  })
}