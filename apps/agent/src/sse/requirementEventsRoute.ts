import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from './SseHub.js'

export interface SseRoutesOptions {
  hub: SseHub
}

function encode(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const sseRoutes: FastifyPluginAsync<SseRoutesOptions> = async (fastify, opts) => {
  const { hub } = opts
  fastify.get<{ Params: { id: string } }>(
    '/api/requirement/:id/events',
    async (req, reply) => {
      const reqId = req.params.id
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.hijack()

      const sid = randomUUID()
      const write = (event: SseEvent): void => {
        try {
          reply.raw.write(encode(event))
        } catch {
          /* socket already closed */
        }
      }

      write({ type: 'hello', sid, reqId, ts: Date.now() })

      const unsubscribe = hub.subscribe(reqId, write)
      const cleanup = (): void => {
        unsubscribe()
        reply.raw.off('close', cleanup)
      }
      reply.raw.on('close', cleanup)
    },
  )
}
