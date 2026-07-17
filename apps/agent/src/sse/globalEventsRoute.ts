/**
 * 全局需求事件 SSE 通道(ticket 07a)
 *
 * 端点:GET /api/events/requirements
 * channelId = 固定字符串 'requirements'(全局 key,跨所有需求订阅)
 *
 * 与 per-req 通道(/api/requirement/:id/events)的区别:
 * - per-req:订阅者只关心某个 reqId 的事件
 * - global:订阅者关心"任何 req 的 created/updated"事件(dashboard / list 页面)
 *
 * 鉴权:authPlugin 全局 onRequest hook 自动保护(除非 { config: { public: true } })。
 * EventSource 浏览器原生无法带自定义 header,需要 cookie(已 bootstrap,跨端口同源共享)。
 *
 * 推送:POST /api/requirements 成功时,route 层调 sseHub.publish('requirements', ...)
 * —— 见 apps/agent/src/routes/requirement.ts step 3b。
 */
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from './SseHub.js'

const GLOBAL_CHANNEL = 'requirements'

export interface GlobalEventsRouteOptions {
  hub: SseHub
}

function encode(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const globalEventsRoutes: FastifyPluginAsync<GlobalEventsRouteOptions> = async (
  fastify,
  opts,
) => {
  const { hub } = opts

  fastify.get('/api/events/requirements', async (req, reply) => {
    const sid = randomUUID()
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.hijack()

    const write = (event: SseEvent): void => {
      try {
        reply.raw.write(encode(event))
      } catch {
        /* socket already closed */
      }
    }

    write({ type: 'hello', sid, channel: GLOBAL_CHANNEL, ts: Date.now() })

    const unsubscribe = hub.subscribe(GLOBAL_CHANNEL, write)
    const cleanup = (): void => {
      unsubscribe()
      reply.raw.off('close', cleanup)
    }
    reply.raw.on('close', cleanup)
  })
}