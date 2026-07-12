import type { FastifyInstance } from 'fastify'

function notImplemented(feature: string, issue: string): {
  error: 'not_implemented'
  feature: string
  message: string
  issue: string
} {
  return {
    error: 'not_implemented',
    feature,
    message: `本期骨架仅占位；真实实装见 issue ${issue}`,
    issue,
  }
}

export async function requirementRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/requirement', async (_req, reply) => {
    return reply.code(501).send(notImplemented('requirement.create', '05'))
  })

  app.get('/api/requirements', async (_req, reply) => {
    return reply.code(501).send(notImplemented('requirement.list', '05'))
  })

  app.get<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.detail', '05'))
  })

  app.patch<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.update', '05'))
  })

  app.post<{ Params: { id: string } }>(
    '/api/requirement/:id/skill',
    async (req, reply) => {
      return reply.code(501).send(notImplemented('requirement.run_skill', '08'))
    },
  )
}
