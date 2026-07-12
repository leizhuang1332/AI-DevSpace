import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { TokenManager } from './auth/TokenManager.js'
import { authPlugin } from './auth/authPlugin.js'
import { WorkspaceService } from './services/WorkspaceService.js'
import { HealthService } from './services/HealthService.js'
import { workspaceRoutes } from './routes/workspace.js'
import { requirementRoutes } from './routes/requirement.js'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { createSseHub, type SseHub } from './sse/SseHub.js'
import { sseRoutes } from './sse/requirementEventsRoute.js'

const ALLOWED_ORIGINS: string[] = ['http://localhost:3333', 'http://127.0.0.1:3333']

function defaultLogPath(): string {
  return join(homedir(), '.aidevspace', 'logs', 'agent.log')
}

function defaultWorkspaceRoot(): string {
  return process.env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')
}

export interface BuildServerOptions {
  workspaceRoot?: string
  logFilePath?: string
  agentVersion?: string
}

/**
 * Build a fully-wired Fastify instance. The caller chooses whether to .listen().
 * TokenManager.ensure() is awaited here so any 401-strict routes are safe.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspaceRoot()
  const logFilePath = opts.logFilePath ?? defaultLogPath()
  const bootTime = new Date()
  mkdirSync(dirname(logFilePath), { recursive: true })

  // Dual-sink logger: stdout (for dev/pm2 dashboards) + append file.
  // Fastify's own logger option accepts a transport config — pino/file is bundled.
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: {
        targets: [
          { target: 'pino/file', options: { destination: logFilePath, mkdir: false } },
          { target: 'pino/file', options: { destination: 1 } }, // stdout fd
        ],
      },
    },
  })

  await fastify.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  })

  // 1. Token
  const tokenManager = new TokenManager(workspaceRoot, {
    warn: (msg, ctx) => fastify.log.warn(ctx ?? {}, msg),
  })
  await tokenManager.ensure()

  // 2. Auth plugin (registers onRequest hook; fp() wraps it for cross-cutting scope)
  await fastify.register(authPlugin, { tokenManager, allowedOrigins: ALLOWED_ORIGINS })

  // 3. SSE hub + routes
  const hub: SseHub = createSseHub()
  await fastify.register(sseRoutes, { hub })

  // 4. Workspace (init idempotent)
  const workspace = new WorkspaceService(workspaceRoot)
  try {
    await workspace.initWorkspace()
    fastify.log.info({ root: workspace.root }, 'workspace initialized')
  } catch (err) {
    fastify.log.error({ err, root: workspace.root }, 'workspace init failed')
    throw err
  }

  // 5. Routes
  const healthService = new HealthService({
    root: workspaceRoot,
    tokenManager,
    allowedOrigins: ALLOWED_ORIGINS,
    logFilePath,
    sseHubStats: () => hub.stats(),
    bootTime,
    agentVersion: opts.agentVersion ?? '0.0.0',
  })
  fastify.get('/api/health', { config: { public: true } }, async () => healthService.collect())
  await fastify.register(workspaceRoutes, { workspace })
  await fastify.register(requirementRoutes)
  await fastify.register(bootstrapRoutes, { tokenManager, apiBase: 'http://localhost:7777' })

  fastify.addHook('onClose', async () => {
    await hub.close()
  })

  return fastify
}

// Cross-platform isMain detection (Windows uses backslash in process.argv[1])
const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : ''
const isMain = entryPath === process.argv[1]

if (isMain) {
  const port = Number(process.env.PORT ?? 7777)
  const host = process.env.HOST ?? '0.0.0.0'
  const workspaceRoot = process.env.AIDEVSPACE_HOME ?? defaultWorkspaceRoot()
  const logFilePath = process.env.AGENT_LOG_FILE ?? defaultLogPath()
  const app = await buildServer({ workspaceRoot, logFilePath })
  try {
    await app.listen({ port, host })
    app.log.info(`agent listening on http://${host}:${port}`)
    // Write PID file (best-effort, used by the bash watcher)
    const pidPath = join(workspaceRoot, '.agent.pid')
    mkdirSync(dirname(pidPath), { recursive: true })
    writeFileSync(pidPath, String(process.pid))
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
