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
import { reposRoutes } from './routes/repos.js'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { analysisRoutes } from './routes/analysis.js'
import { spikeRoutes } from './routes/spike.js'
import { createWorktreeManager, createDefaultGitExec } from './worktree/WorktreeManager.js'
import { RequirementService } from './services/RequirementService.js'
import { createSseHub, type SseHub } from './sse/SseHub.js'
import { sseRoutes } from './sse/requirementEventsRoute.js'
import { globalEventsRoutes } from './sse/globalEventsRoute.js'
import { sessionSseRoutes } from './sse/sessionEventsRoute.js'
import { sessionStateRoutes } from './routes/sessionStateRoute.js'
import { makeStateChangePublisher } from './sse/sessionBroadcaster.js'
import { SessionStateRegistry } from './session/SessionStateRegistry.js'
import { createCcSwitchClient, createNullCcSwitchClient } from './providers/CcSwitchClient.js'
import type { CcSwitchClient } from './providers/CcSwitchClient.js'
import { createClaudeCodeProvider } from './providers/ClaudeCodeProvider.js'
import type { RetryableSession } from './providers/ClaudeCodeProvider.js'
import type { AIProvider } from './providers/AIProvider.js'
import { SessionStore } from './session/SessionStore.js'
import { MessagesMirror } from './session/MessagesMirror.js'
import { ProviderSemaphore } from './error/ProviderSemaphore.js'
import { SessionLogger } from './log/SessionLogger.js'
import { GlobalLogger } from './log/GlobalLogger.js'
import { sessionsRetryRoutes, type RunTurn } from './routes/sessionsRetryRoute.js'

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
  /**
   * ticket 01 (ADR-0020 D8):start handler 真接 SDK,需要 AIProvider 实例。
   * 未传时默认构造 ClaudeCodeProvider(同既有 buildServer 内部行为);
   * 测试可通过 `buildServer({ provider: fakeProvider })` 注入 fake provider,
   * 避免 CI 触发真 SDK 子进程。
   */
  provider?: AIProvider
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
    // ticket 03 (ADR-0015 D7) —— 上传 bodyLimit 默认 1 MiB,会拦截 ≥750 KB
    // 的原文件(对应 base64 后 ≈ 1 MiB)。提至 16 MiB:
    // - MAX_UPLOAD_BYTES = 10 MiB,base64 后 ≈ 13.3 MiB,留 buffer 给 JSON envelope
    // - 与上传管道其他路径(校验 / 解析 / 落盘)保持上限一致
    bodyLimit: 16 * 1024 * 1024,
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
  // ticket 07a:全局需求事件通道(dashboard / list 页面订阅 'requirements' channel)
  await fastify.register(globalEventsRoutes, { hub })

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
  // P5 · Q10.4:StatusBar 4 指示器状态注册表 —— server 启动时构造,spike route 共享
  const sessionStateRegistry = new SessionStateRegistry({
    providerSemaphore,
    recentWritesWindowMs: 60_000,
  })
  // P5 · Q10.2:per-session SSE 路由(通道 key = localSid);需要 sessionStore 校验存在
  await fastify.register(sessionSseRoutes, { hub, sessionStore })
  // P5 · Q10.4:session 状态 REST 路由(StatusBar refresh + 全局 4 指示器)
  await fastify.register(sessionStateRoutes, { registry: sessionStateRegistry, store: sessionStore })

  // P4 · Task 4:active session registry (localSid → AISession).
  // provider 通过 onSessionCreated 回调 push;retry route 通过本 Map 找到目标 session
  // 调 send({ isRetry: true })。Map 允许重复 id 覆盖(spike 测试需要 reset 模式),
  // 真实生产 key 由 provider 用 UUID 保证唯一。
  const retrySessions = new Map<string, RetryableSession>()

  const provider: AIProvider = opts.provider ?? createClaudeCodeProvider({
    ccSwitch,
    debug: false,
    providerSemaphore,
    sessionLogger,
    sessionStore,
    globalLogger,
    onSessionCreated: (entry) => {
      retrySessions.set(entry.id, entry)
    },
    // P4 · Task 5:把 query_succeeded 通过 SseHub 发布,Web 端收到后把 status 重置 idle
    onLifecycle: (ev) => {
      const event = {
        type: 'query_succeeded' as const,
        reqId: ev.reqId,
        sessionId: ev.sessionId,
        runId: ev.runId,
        ts: ev.ts,
        durationMs: ev.durationMs,
        attempts: ev.attempts,
      }
      hub.publish(ev.reqId, event)
      // P5 · Q10.2:也推到 per-session 通道(Web 端开单 session tab 时订阅)
      hub.publish(ev.sessionId, event)
    },
    // P5 · Q10.4:state 变化 → publish 到 req + session 双通道
    onSessionStateChange: makeStateChangePublisher(hub),
    onSessionCancelled: async ({ localSid }) => {
      await sessionStore.updateSession(localSid, {
        last_cancel_at: new Date().toISOString(),
      })
    },
  })

  const runTurn: RunTurn = async (input) => {
    const resolved = retrySessions.get(input.localSid)
    if (!resolved) throw new Error(`No active session for localSid=${input.localSid}`)
    await resolved.send(input.inputText, { isRetry: input.isRetry })
    return { runId: `retry-${Date.now()}` }
  }

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

  // issue 06 (ADR-0016):GET /api/repos —— 实时 readdir `<root>/repos/`,
  // 无 service 依赖(纯 IO + 字典序排序 + schema 校验)。
  await fastify.register(reposRoutes, { workspaceRoot: workspace.root })

  // ticket 02:实装 POST /api/requirement/:id/repos(worktree 真实创建)
  // - 默认注入 createDefaultGitExec(生产)
  // - 测试 buildServer 时可通过 BuildServerOptions 覆盖 deps(后续 ticket 拓展)
  const gitExec = createDefaultGitExec()
  const worktreeMgr = createWorktreeManager({ root: workspaceRoot, git: gitExec })
  const requirementService = new RequirementService({
    root: workspaceRoot,
    git: gitExec,
    worktreeMgr,
  })
  // ticket 04:注入 sseHub 让 POST /api/requirements 创建成功 / 失败时推
  // `requirement_created` 事件到新建 id 通道,Web 端 DRAFTING 据此切正常态 / 红色 banner
  await fastify.register(requirementRoutes, { requirementService, sseHub: hub })

  await fastify.register(analysisRoutes, { hub, workspaceRoot, provider })
  await fastify.register(spikeRoutes, { hub, provider, ccSwitch, store: sessionStore, mirror: messagesMirror, registry: sessionStateRegistry })
  await fastify.register(bootstrapRoutes, { tokenManager, apiBase: 'http://localhost:7777' })
  // P4 · Task 4:retry route —— UI 点重试时调;GET/sessions/:sid 是 GET,POST /retry 是 action
  await fastify.register(sessionsRetryRoutes, { sessionStore, runTurn })

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
