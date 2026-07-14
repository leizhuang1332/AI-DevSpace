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
import { ZoneRegistry } from './services/ZoneRegistry.js'
import { workspaceRoutes } from './routes/workspace.js'
import { requirementRoutes } from './routes/requirement.js'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { analysisRoutes } from './routes/analysis.js'
import { spikeRoutes } from './routes/spike.js'
import { createSseHub, type SseHub } from './sse/SseHub.js'
import { sseRoutes } from './sse/requirementEventsRoute.js'
import { createCcSwitchClient, createNullCcSwitchClient } from './providers/CcSwitchClient.js'
import type { CcSwitchClient } from './providers/CcSwitchClient.js'
import { createClaudeCodeProvider } from './providers/ClaudeCodeProvider.js'
import { SessionStore } from './session/SessionStore.js'
import { MessagesMirror } from './session/MessagesMirror.js'
import { ProviderSemaphore } from './error/ProviderSemaphore.js'
import { SessionLogger } from './log/SessionLogger.js'
import { GlobalLogger } from './log/GlobalLogger.js'

const ALLOWED_ORIGINS: string[] = ['http://localhost:3333', 'http://127.0.0.1:3333']

function defaultLogPath(): string {
  return join(homedir(), '.aidevspace', 'logs', 'agent.log')
}

function defaultWorkspaceRoot(): string {
  return process.env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')
}

/**
 * 默认工位注册表目录:与 server.ts 同级的 zones/ 目录。
 * 部署时可由 AIDEVSPACE_ZONES_DIR 或 BuildServerOptions.zonesDir 覆盖。
 */
function defaultZonesDir(): string {
  const override = process.env.AIDEVSPACE_ZONES_DIR?.trim()
  return override && override.length > 0
    ? override
    : join(dirname(fileURLToPath(import.meta.url)), 'zones')
}

export interface BuildServerOptions {
  workspaceRoot?: string
  logFilePath?: string
  agentVersion?: string
  zonesDir?: string
}

/**
 * Build a fully-wired Fastify instance. The caller chooses whether to .listen().
 * TokenManager.ensure() is awaited here so any 401-strict routes are safe.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspaceRoot()
  const logFilePath = opts.logFilePath ?? defaultLogPath()
  const zonesDir = opts.zonesDir ?? defaultZonesDir()
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

  // 5. Zone registry (load + validate all built-in zone yaml at boot)
  const zoneRegistry = new ZoneRegistry(zonesDir)
  try {
    const zones = await zoneRegistry.loadAllZones()
    fastify.log.info(
      `${zones.length} zones loaded: ${zones.map((z) => z.id).join(', ')}`,
    )
  } catch (err) {
    fastify.log.error({ err, zonesDir }, 'zone registry load failed')
    throw err
  }

  // 5b. CcSwitchClient (Q9) + AIProvider (Q2)
  // —— 若 db 缺失/解析失败,降级为空 client (无 provider),不影响其他模块启动
  let ccSwitch: CcSwitchClient
  try {
    ccSwitch = await createCcSwitchClient({
      log: (msg) => fastify.log.info(msg),
    })
  } catch (err) {
    fastify.log.error({ err }, 'cc-switch client init failed; spike routes will warn')
    ccSwitch = createNullCcSwitchClient()
  }

  // 5c. 持久化 + 日志依赖(P4 Task 8)
  const sessionStore = new SessionStore({ root: workspaceRoot })
  const messagesMirror = new MessagesMirror({ root: workspaceRoot })
  const globalLogger = new GlobalLogger(fastify.log)
  const sessionLogger = new SessionLogger({
    root: workspaceRoot,
    onWriteError: (error, input) => globalLogger.sessionLogWriteFailed(error, {
      reqId: input.reqId,
      sessionId: input.localSid,
    }),
  })
  const providerSemaphore = new ProviderSemaphore({ limit: 5 })

  const provider = createClaudeCodeProvider({
    ccSwitch,
    debug: false,
    providerSemaphore,
    sessionLogger,
    globalLogger,
    onSessionCancelled: async ({ localSid }) => {
      await sessionStore.updateSession(localSid, {
        last_cancel_at: new Date().toISOString(),
      })
    },
  })

  // 6. Routes
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
  await fastify.register(analysisRoutes, { hub })
  await fastify.register(spikeRoutes, { hub, provider, ccSwitch, store: sessionStore, mirror: messagesMirror })
  await fastify.register(bootstrapRoutes, { tokenManager, apiBase: 'http://localhost:7777' })

  // 7. 启动 / 配置变更日志
  globalLogger.agentStarted({ root: workspaceRoot, version: opts.agentVersion ?? '0.0.0' })
  const configured = ccSwitch.getCurrent()
  globalLogger.configChanged({
    provider: configured?.name ?? null,
    model: configured?.models.main ?? null,
  })

  fastify.addHook('onClose', async () => {
    await hub.close()
    await provider.shutdown()
    ccSwitch.close()
    globalLogger.agentStopped({ reason: 'server_close' })
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
