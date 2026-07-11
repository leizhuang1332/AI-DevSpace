import fp from 'fastify-plugin'
import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { parseCookie } from './cookie.js'
import type { TokenManager } from './TokenManager.js'

export interface AuthPluginOptions {
  tokenManager: TokenManager
  allowedOrigins: string[]
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

const authImpl: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { tokenManager, allowedOrigins } = opts
  fastify.addHook('onRequest', async (req, reply) => {
    // Public bypass: routes declare { config: { public: true } }
    const cfg = (req.routeOptions.config ?? {}) as { public?: boolean }
    if (cfg.public) return

    const cookieTok = parseCookie(req.headers.cookie, 'aidevspace_token')
    const headerRaw = req.headers['x-aidevspace-token']
    const headerTok = typeof headerRaw === 'string' ? headerRaw : null
    const candidate = cookieTok ?? headerTok

    if (!candidate || !safeEqual(candidate, tokenManager.get())) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const origin = req.headers.origin
    if (origin && !allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed', origin })
    }
  })
}

// `fp()` opts out of Fastify's plugin encapsulation so the onRequest hook
// applies to sibling routes on the parent Fastify instance (auth is
// cross-cutting, not just sub-tree-scoped).
export const authPlugin = fp<AuthPluginOptions>(authImpl, { name: 'authPlugin' })
