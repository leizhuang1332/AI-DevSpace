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
import { reposRoutes } from './routes/repos.js'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { spikeRoutes } from './routes/spike.js'
import { analysisSkillRoutes } from './routes/analysis-skill.js'
import { analysisRunRoutes } from './routes/analysis-run.js'
import { analysisResponseRoutes } from './routes/analysis-response.js'
import { AnalysisRunService } from './analysis-run/AnalysisRunService.js'
import { AnalysisSkillService } from './analysis-skill/AnalysisSkillService.js'
import { createCodebaseManager } from './codebase/CodebaseManager.js'
import type { GitExec } from './codebase/CodebaseManager.js'
// issue 05 (ADR-0030 D3 / 决策账本 C5):createDefaultGitExec 从 worktree/ 提到
// git/ 下,强制注入 GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS="" / SSH_ASKPASS="",
// 防止缺凭据时 git 在后台进程 stdin 挂死。
import { createDefaultGitExec } from './git/createDefaultGitExec.js'
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
import { FakeChatProvider } from './providers/FakeChatProvider.js'
import {
  readCache as readDefaultSystemPromptCache,
  ensureCached,
  getCachePath as getDefaultSystemPromptCachePath,
} from './providers/defaultSystemPromptCache.js'
import type { AIProvider } from './providers/AIProvider.js'
import { SessionStore } from './session/SessionStore.js'
import { MessagesMirror } from './session/MessagesMirror.js'
import { ProviderSemaphore } from './error/ProviderSemaphore.js'
import { SessionLogger } from './log/SessionLogger.js'
import { GlobalLogger } from './log/GlobalLogger.js'
import { sessionsRetryRoutes, type RunTurn } from './routes/sessionsRetryRoute.js'
import { TaskCardStore } from './services/board/TaskCardStore.js'
import { boardCardRoutes } from './routes/board-cards.js'
import { OverrideLog } from './services/board/OverrideLog.js'
import { boardRoutes } from './routes/board.js'
import { boardTranscriptRoutes } from './routes/board-transcript.js'
import { TaskCardTranscriptService } from './services/board/TaskCardTranscript.js'
import { ChatSessionService } from './services/board/ChatSessionService.js'
import { boardChatRoutes } from './routes/board-chat.js'
import { prdSplitRoutes } from './prd-split/PrdSplitRoute.js'
import { PrdSplitService } from './prd-split/PrdSplitService.js'

const ALLOWED_ORIGINS: string[] = ['http://localhost:3333', 'http://127.0.0.1:3333']

function defaultLogPath(): string {
  return join(homedir(), '.aidevspace', 'logs', 'agent.log')
}

/**
 * 默认 workspace 根目录 → 复用 `WorkspaceService.resolveRoot()`,自动归一化
 * Git Bash mingw 路径(`/c/foo` → `C:\foo`)。此处不再独立读 env,消除 DRY 违反。
 */
function defaultWorkspaceRoot(): string {
  return WorkspaceService.resolveRoot()
}

export interface BuildServerOptions {
  workspaceRoot?: string
  logFilePath?: string
  agentVersion?: string
  /**
   * ticket 01 (ADR-0020 D8):start handler 真接 SDK,需要 AIProvider 实例。
   * 未传时默认构造 ClaudeCodeProvider(同既有 buildServer 内部行为);
   * 测试可通过 `buildServer({ provider: fakeProvider })` 注入 fake provider,
   * 避免 CI 触发真 SDK 子进程。
   */
  provider?: AIProvider
  /**
   * issue 02 (ADR-0030 D8):POST /api/repos / PUT /api/repos/:name 必跑
   * `git ls-remote` 验证可达 + 凭据可用(决策 Q5)。未传时默认构造
   * `createDefaultGitExec()`(生产);测试可通过 `buildServer({ git: fakeExec })`
   * 注入 fake git exec,避免 CI 触发真 git 子进程。
   *
   * 注意:这个 git 实例也用于 RequirementService.attachRepos(issue 02 worktree
   * 路径) —— 那条路径在 issue 03 切到 clone 后会改用 clone exec(届时再调整)。
   */
  git?: GitExec
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

  // 4. Workspace (init idempotent — 含 ADR-0026 一次性清理 ~/.aidevspace/zones/*.yaml)
  const workspace = new WorkspaceService(workspaceRoot)
  try {
    const initResult = await workspace.initWorkspace()
    fastify.log.info(
      { root: workspace.root, ...initResult },
      'workspace initialized',
    )
  } catch (err) {
    fastify.log.error({ err, root: workspace.root }, 'workspace init failed')
    throw err
  }

  // 5a. Analysis Skill 初始化(issue 01 · ADR-0021)
  //     - 确保 `<root>/analysis-skills/` 存在
  //     - reserved 名称缺失 → 用系统版本写入
  //     - reserved 名称已存在但内容漂移 → 升级覆盖
  //     - 其他名称 → 保留
  const analysisSkillService = new AnalysisSkillService(workspaceRoot)
  try {
    const initResult = analysisSkillService.init()
    fastify.log.info(
      {
        seeded: initResult.seededReserved,
        upgraded: initResult.upgradedReserved,
        finalCount: initResult.finalCount,
        dir: analysisSkillService.skillsDir,
      },
      'analysis skills initialized',
    )
  } catch (err) {
    fastify.log.error(
      { err, dir: analysisSkillService.skillsDir },
      'analysis skills init failed',
    )
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
    // 同步读取 SDK default system prompt cache —— dump 时打
    defaultSystemPromptReader: () => readDefaultSystemPromptCache(workspaceRoot),
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

  // issue 02 (ADR-0030 D8):`/api/repos` CRUD —— GET 读 yaml 注册表;
  // POST / PUT 必跑 `git ls-remote` 验证可达 + 凭据可用(决策 Q5);
  // DELETE 检查 codebase 复用 + force 标记;详见 issue 02 ticket。
  await fastify.register(reposRoutes, {
    workspace: workspace,
    git: opts.git ?? createDefaultGitExec(),
  })

  // issue 03 (ADR-0030 D3 / D5):实装 POST /api/requirement/:id/repos(独立 clone)
  // - 默认注入 createDefaultGitExec(生产,强制 env 注入)
  // - 测试 buildServer 时可通过 BuildServerOptions 覆盖 deps
  // Issue 09:注入 fastify.log 作 safeRm 的 logger,让 fd 竞争 / 半成品残留可观测
  const gitExec = createDefaultGitExec()
  const codebaseMgr = createCodebaseManager({
    root: workspaceRoot,
    git: gitExec,
    logger: fastify.log,
  })
  const requirementService = new RequirementService({
    root: workspaceRoot,
    git: gitExec,
    codebaseMgr,
    sseHub: hub,
    workspace,
  })

  // issue 03 · 启动时收敛 orphan pending 半成品
  // 场景:Agent 异常退出(kill -9 / OOM)→ clone 进行中但 pending 标记残留,
  // 下次启动必须清半成品目录 + 标记,避免"显示已关联但 git 不可用"的脏态
  try {
    const orphans = await codebaseMgr.scanOrphanedPending()
    for (const { reqId, repoName, path } of orphans) {
      fastify.log.warn(
        { reqId, repoName, path },
        'codebase: cleaning orphaned clone on boot',
      )
      await codebaseMgr.remove(reqId, repoName)
      await codebaseMgr.clearPending(reqId, repoName)
    }
    if (orphans.length > 0) {
      fastify.log.info(
        { count: orphans.length },
        'codebase: orphan pending cleaned on boot',
      )
    }
  } catch (err) {
    // 启动时清理失败不应阻断 agent 启动;仅记日志
    fastify.log.error({ err }, 'codebase: orphan pending cleanup failed on boot')
  }

  // issue 10 · 启动时收敛 orphan `.git-only` codebase 目录
  // 场景:上次 attach 走到 `git checkout -b` 失败(branchName 与 default 分支同名等),
  // safeRm 又因 fd 竞争漏过 .git 残留 → 半成品盘上无 .pending- 标记,
  // scanOrphanedPending 扫不到。复用 Issue 09 的 isCompleteCodebase 判定
  // 「.git 残留但 working tree 空」的目录并统一清掉。
  // 调用顺序:先 scanOrphanedPending 再 scanOrphanedCodebases —— 前者清更严重的「半成品」,
  // 后者只清「半完整」残留。
  try {
    const orphanCodebases = await codebaseMgr.scanOrphanedCodebases()
    for (const { reqId, repoName, path } of orphanCodebases) {
      fastify.log.warn(
        { reqId, repoName, path },
        'codebase: cleaning orphaned .git-only directory on boot',
      )
      await codebaseMgr.remove(reqId, repoName)
    }
    if (orphanCodebases.length > 0) {
      fastify.log.info(
        { count: orphanCodebases.length },
        'codebase: orphan .git-only directory cleaned on boot',
      )
    }
  } catch (err) {
    // 启动期清理失败不应阻断 agent 启动;仅日志告警
    fastify.log.error(
      { err },
      'codebase: orphan .git-only cleanup failed on boot',
    )
  }

  // ticket 04:注入 sseHub 让 POST /api/requirements 创建成功 / 失败时推
  // `requirement_created` 事件到新建 id 通道,Web 端 DRAFTING 据此切正常态 / 红色 banner
  await fastify.register(requirementRoutes, { requirementService, sseHub: hub })

  // issue 02 + issue 04 (ADR-0021):同一 AnalysisRunService 实例供 Run start /
  // Response CRUD 共享状态(进程级 toolUseIndex + 单运行约束 + response meta 索引)
  const runService = new AnalysisRunService(workspaceRoot)

  // issue 07 · 启动时收敛 orphan running Run
  // 场景:Agent 异常退出(kill -9 / OOM)→ 残留 status=running Run + .startup.lock
  // 新进程没有任何 in-flight runner 句柄可继续推进,必须把它们收敛为 failed
  // 并释放单运行锁,让用户可以创建新 Run。当前设计下没有跨进程 in-flight 句柄
  // 共享,传 null 把所有 running Run 都视为 orphan(issue 07 验收 9)。
  try {
    // PR-A (ticket 11):必须 await —— reconcileRunningRuns 内部
    // 显式 await 每个 recovered Requirement 的 releaseStartupLock,
    // 同步保证 boot 完成后所有 startup lock 已不存在。
    // 否则事件循环 race 下 lock 可能残留,POST /start 撞 EEXIST。
    const reconcileResult = await runService.reconcileRunningRuns(null)
    if (reconcileResult.recovered.length > 0) {
      fastify.log.warn(
        {
          count: reconcileResult.recovered.length,
          runs: reconcileResult.recovered,
        },
        'analysis run: orphan running runs recovered on boot',
      )
    }
    if (reconcileResult.skipped.length > 0) {
      fastify.log.info(
        {
          count: reconcileResult.skipped.length,
          runs: reconcileResult.skipped,
        },
        'analysis run: orphan recovery skipped some runs',
      )
    }
  } catch (err) {
    // 启动时 reconcile 失败不应阻断 agent 启动;仅记日志
    fastify.log.error({ err }, 'analysis run: orphan recovery failed on boot')
  }

  // issue 01 (ADR-0021):Analysis Skill catalog + per-requirement selection endpoints
  await fastify.register(analysisSkillRoutes, { workspaceRoot })
  // issue 02 (ADR-0021):Analysis Run start / list / detail + SDK 集成
  await fastify.register(analysisRunRoutes, { hub, provider, workspaceRoot })
  // issue 04 (ADR-0021):Issue Response CRUD + 已答复上下文装配预检
  await fastify.register(analysisResponseRoutes, { workspaceRoot, runService })
  await fastify.register(spikeRoutes, { hub, provider, ccSwitch, store: sessionStore, mirror: messagesMirror, registry: sessionStateRegistry })
  await fastify.register(bootstrapRoutes, { tokenManager, apiBase: 'http://localhost:7777' })
  // P4 · Task 4:retry route —— UI 点重试时调;GET/sessions/:sid 是 GET,POST /retry 是 action
  await fastify.register(sessionsRetryRoutes, { sessionStore, runTurn })

  // issue 02 (ADR-0024) —— board section 的 TaskCardStore + REST 端点
  // (GET/GET-by-id/POST/PATCH/POST archive)。不动 ClaudeCodeProvider /
  // runAnalysisQuery 路径(ADR-0023 守门)。
  const taskCardStore = new TaskCardStore({ root: workspaceRoot })
  await fastify.register(boardCardRoutes, { store: taskCardStore })

  // issue 03 (ADR-0025) —— StatusConstraintGuard + OverrideLog:
  // PATCH /api/requirement/:id/board/cards/:cardId/status 走 Guard,
  // 违规返回 conflicts 让 web 弹 Modal;override=true 写 board/overrides.log。
  const overrideLog = new OverrideLog({ root: workspaceRoot })
  await fastify.register(boardRoutes, {
    taskCardStore,
    overrideLog,
    requirementService,
  })

  // issue 05 (ADR-0027 D4) —— PRD 拆解 Run:POST /split-from-prd +
  // GET/DELETE runs。直接调 provider.runAnalysisQuery(底层 SDK query
  // 入口),自带 propose_card 业务工具 + 自管 analysis/proposals/<run-id>/
  // 产物。**不动** ClaudeCodeProvider(ADR-0023 zero-touch)。
  const prdSplitService = new PrdSplitService({ root: workspaceRoot })
  // boot 时收敛 orphan running Run(镜像 analysis run reconcileRunningRuns)
  try {
    const reconcile = await prdSplitService.reconcileOrphanRuns()
    if (reconcile.recovered.length > 0) {
      fastify.log.warn(
        { count: reconcile.recovered.length, runs: reconcile.recovered },
        'prd split: orphan runs recovered on boot',
      )
    }
  } catch (err) {
    fastify.log.error({ err }, 'prd split: orphan recovery failed on boot')
  }
  await fastify.register(prdSplitRoutes, { hub, provider, workspaceRoot })

  // issue 08 (ADR-0028 D5) —— TaskCard transcript HTTP 端点:
  // GET /board/cards/:cardId/transcript + POST .../transcript/messages。
  // 纯文件 IO(读写 transcript.yaml),零触达 Run 路径(守门 ADR-0023 zero-touch)。
  // role 强制 'user' + tool_calls 强制 [](服务层守门)。
  const taskCardTranscriptService = new TaskCardTranscriptService(workspaceRoot)
  await fastify.register(boardTranscriptRoutes, {
    taskCardStore: taskCardStore,
    transcriptService: taskCardTranscriptService,
  })

  // issue 05 (ADR-0029 D9 + D10) —— board chat HTTP + SSE 端点:
  // 7 条端点(start / query SSE / snapshot / model / plan-mode / permission / cost-cap)。
  // 走 Provider.runChatQuery(独立命名空间,守门 ADR-0023 zero-touch);
  // SSE per-query 严格单 tab lock。
  const chatSessionService = new ChatSessionService({ workspaceRoot })
  await fastify.register(boardChatRoutes, {
    workspaceRoot,
    taskCardStore,
    chatSessionService,
    provider,
  })

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
  // defaultWorkspaceRoot() 内部已读 AIDEVSPACE_HOME + normalize,无需重复
  const workspaceRoot = defaultWorkspaceRoot()
  const logFilePath = process.env.AGENT_LOG_FILE ?? defaultLogPath()
  // issue 09 e2e 守门 —— `AIDEVSPACE_FAKE_CHAT_PROVIDER=1` 时用脚本化
  // FakeChatProvider(确定性 emit PermissionPrompt / PlanModePrompt 等 11 步
  // e2e 流程),不走真 ClaudeCodeProvider,无需 ANTHROPIC_API_KEY。
  // 生产 / 本机 dev 不设该 env → 走真 createClaudeCodeProvider,行为不变。
  const providerOverride =
    process.env.AIDEVSPACE_FAKE_CHAT_PROVIDER === '1'
      ? new FakeChatProvider()
      : undefined
  const app = await buildServer({
    workspaceRoot,
    logFilePath,
    ...(providerOverride ? { provider: providerOverride } : {}),
  })

  // ── 可选:启动时自动 capture SDK default system prompt ──
  // AIDEVSPACE_CAPTURE_DEFAULT_SYSTEM_PROMPT=1 时触发,缺则跳过。
  // cache 已存在则跳过(用 --force 走脚本重抓)。
  if (process.env.AIDEVSPACE_CAPTURE_DEFAULT_SYSTEM_PROMPT === '1') {
    const existing = readDefaultSystemPromptCache(workspaceRoot)
    if (existing) {
      app.log.info(
        { cached_at: existing.captured_at, claude: existing.claude_version },
        'sdk default system prompt cache present; skipping capture',
      )
    } else {
      app.log.info('capturing sdk default system prompt (one-time, ~3-5s) …')
      ensureCached({ workspaceRoot })
        .then((cached) => {
          if (cached) {
            app.log.info(
              {
                claude: cached.claude_version,
                chars: cached.system_combined_chars,
                blocks: cached.system_blocks.length,
                path: getDefaultSystemPromptCachePath(workspaceRoot),
              },
              'sdk default system prompt captured',
            )
          }
        })
        .catch((err) => {
          app.log.warn({ err: String(err) }, 'sdk default system prompt capture failed (non-fatal)')
        })
    }
  }

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
