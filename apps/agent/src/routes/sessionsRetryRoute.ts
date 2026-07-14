import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { SessionStore } from '../session/SessionStore.js'

/** retry handler —— 由 server 注入,通过 localSid 拿到 AISession 实例并 dispatch send(isRetry=true) */
export type RunTurn = (input: {
  localSid: string
  inputText: string
  signal?: AbortSignal
  isRetry?: boolean
}) => Promise<{ runId: string }>

export interface SessionsRetryRoutesOptions {
  sessionStore: SessionStore
  runTurn: RunTurn
}

export const sessionsRetryRoutes: FastifyPluginAsync<SessionsRetryRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { sessionStore, runTurn } = opts

  app.post<{ Params: { localSid: string }; Body: { reqId: string; runId?: string } }>(
    '/sessions/:localSid/retry',
    async (req, reply) => {
      const { localSid } = req.params
      const meta = await sessionStore.getSession(localSid).catch(() => null)
      if (!meta) {
        return reply
          .code(404)
          .send({ error: 'session_not_found', message: `Session ${localSid} not found` })
      }
      if (!meta.last_input) {
        return reply.code(409).send({
          error: 'no_retryable_input',
          message: 'No previous input recorded for this session',
        })
      }
      const controller = new AbortController()
      const result = await runTurn({
        localSid,
        inputText: meta.last_input,
        signal: controller.signal,
        isRetry: true,
      })
      return reply.code(200).send({
        retryToken: `retry-${Date.now()}-${localSid}`,
        runId: result.runId,
      })
    },
  )
}
