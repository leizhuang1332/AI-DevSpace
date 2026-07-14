/**
 * Per-session SSE 路由 —— ADR-0010 Q10.2 (N 条独立 SSE 通道)
 *
 * 与 `requirementEventsRoute.ts` 形态对称,但订阅 key 用 `localSid`
 * (per-session 通道)。Web 端一个页面打开 N 个 session tab 时,每个
 * tab 订阅自己的 SSE,事件互不串台。
 *
 * 端点:`GET /api/requirement/:reqId/session/:sid/events`
 *  - `:reqId` 路径占位 —— 路由层做基本存在校验(404),不真正用作 key
 *  - `:sid`  = AISession.id(稳定 localSid);用作 hub 通道 key
 *  - subscribe 路径与 req 级 hub 完全独立;close 时也只清自己
 *
 * 会话关闭 → AISession.close() 在 server 层调 `hub.closeChannel(sid)`,
 * 已经订阅的 SSE 连接收到 normal close(TCP),不需要本路由做任何事。
 */

import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from './SseHub.js'
import type { SessionStore } from '../session/SessionStore.js'

export interface SessionSseRoutesOptions {
  hub: SseHub
  /** 用于 reqId/sid 存在性校验 —— 找不到时返 404 而非开空通道 */
  sessionStore: SessionStore
}

function encode(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const sessionSseRoutes: FastifyPluginAsync<SessionSseRoutesOptions> = async (fastify, opts) => {
  const { hub, sessionStore } = opts

  fastify.get<{ Params: { reqId: string; sid: string } }>(
    '/api/requirement/:reqId/session/:sid/events',
    async (req, reply) => {
      const { reqId, sid } = req.params

      // 校验 session 存在 —— 避免给幽灵 sid 开长连
      // (Q10.2 验收:同时开 3 个 session → 3 条独立 SSE;不存在的 sid → 404)
      const meta = await sessionStore.getSession(sid).catch(() => null)
      if (!meta) {
        return reply.code(404).send({
          error: 'session_not_found',
          message: `Session ${sid} not found`,
        })
      }
      if (meta.reqId !== reqId) {
        return reply.code(404).send({
          error: 'session_not_found',
          message: `Session ${sid} does not belong to requirement ${reqId}`,
        })
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.hijack()

      const connSid = randomUUID()
      const write = (event: SseEvent): void => {
        try {
          reply.raw.write(encode(event))
        } catch {
          /* socket already closed */
        }
      }

      // hello 携带 sessionId 便于 Web 端 narrow 校验
      write({ type: 'hello', sid: connSid, reqId, ts: Date.now() })

      const unsubscribe = hub.subscribe(sid, write)
      const cleanup = (): void => {
        unsubscribe()
        reply.raw.off('close', cleanup)
      }
      reply.raw.on('close', cleanup)
    },
  )
}