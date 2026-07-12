import type { FastifyPluginAsync } from 'fastify'
import type { TokenManager } from '../auth/TokenManager.js'

export interface BootstrapRoutesOptions {
  tokenManager: TokenManager
  apiBase: string
  agentVersion?: string
}

export const bootstrapRoutes: FastifyPluginAsync<BootstrapRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { tokenManager, apiBase } = opts
  const agentVersion = opts.agentVersion ?? '0.0.0'

  fastify.get(
    '/api/agent/bootstrap',
    { config: { public: true } },
    async (_req, reply) => {
      const token = tokenManager.get()
      return reply.send({
        ok: true as const,
        token,
        cookieName: 'aidevspace_token',
        cookieAttributes: { SameSite: 'Strict' as const, Path: '/', MaxAge: 2_592_000 },
        apiBase,
        agentVersion,
        sseNote: 'EventSource 不能带自定义 header；浏览器侧通过 SameSite=Strict cookie 鉴权',
      })
    },
  )
}
