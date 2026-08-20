/**
 * ChatSessionService —— board chat session 生命周期管理(issue 03 / ADR-0029)
 *
 * 物理路径:`~/.aidevspace/requirements/<reqId>/board/tasks/<ulid>/chat/session.json`
 * 物理独立 SDK 会话日志:`~/.claude/projects/<hash-of-cwd>/<sessionId>.jsonl`
 *
 * **重要事实(ADR-0029 D9a 修订后)**:
 * - **session.json 只存元数据**(model / sessionId / cwd / cumulativeUsage ...)
 * - **真正的消息内容在 SDK jsonl** —— 由 Claude Code SDK 0.3.206 写;
 *   我们不持久化 transcript 事件(避免双写漂移)
 * - Snapshot 渲染历史 = 解析 SDK jsonl → 映射为 `ChatSessionEvent[]`
 *
 * 设计要点(对应 ADR-0029 D4 / D8 / D9 / D16):
 * - **17 项字段 round-trip** —— 与 `ChatSessionMetaSchema` 严格对齐,
 *   服务端不重命名字段(SDK camelCase ↔ 服务端契约一致)
 * - **atomic 写 + fallback** —— 首次拿到 SDK sessionId 后立即 tmp+rename 写
 *   session.json;失败走 fallback:备份损坏文件 → 重写(决策 48)
 * - **30 天 SDK 健康检查** —— session.json.cwd 派生 SDK jsonl 路径;
 *   existsSync 缺失 → 触发重建路径(下次 query 落 system/init 时新 sessionId)
 * - **严格单 tab lock** —— `Map<sessionKey, Promise<void>>` 锁;
 *   同 `(reqId, cardId)` 第二次 query 等待 / 拒绝
 * - **Snapshot → events 数组** —— `parseSdkSessionLog` 解析 SDK jsonl:
 *   init 之后全部 user / assistant(纯 tool_use 拆 chat_tool_call;
 *   含 text/thinking 走 chat_message_assistant);user 消息的 tool_result
 *   拆 chat_tool_result;permission_request 配对 + 注入 synthetic resolved=deny
 *   (session-interrupted)
 * - **Cost 累计** —— 每次 `result` 消息带 `usage`,累加到 session.json.cumulativeUsage
 *   + 同时累加 sub-agent 计费(本期:同样累计到主 session)
 *
 * 守门契约(ADR-0023 D11 + ADR-0029 D11):
 * - 不调用 `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter` 路径
 * - Provider 内部实现走独立命名空间(`chatQuery` / `chatQueryStream`),
 *   不进入 Analysis Run 闭包
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  ChatCumulativeUsageSchema,
  ChatPermissionMode,
  ChatSessionMetaSchema,
  type ChatCumulativeUsage,
  type ChatMcpServerConfig,
  type ChatPermissionModeT,
  type ChatSessionMeta,
  type ChatSessionEvent,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** ChatSessionService 失败时抛错;code 与 HTTP 状态码映射由路由层决定。 */
export class ChatSessionServiceError extends Error {
  constructor(
    public readonly code:
      | 'E_REQUIREMENT_NOT_FOUND'
      | 'E_INVALID_CARD_ID'
      | 'E_SESSION_LOCKED'
      | 'E_IO'
      | 'E_INVALID_SESSION',
    message: string,
  ) {
    super(message)
    this.name = 'ChatSessionServiceError'
  }
}

// ---------------------------------------------------------------------------
// 路径 helper(单点真相,test + route 共享)
// ---------------------------------------------------------------------------

/**
 * `<root>/requirements/<reqId>/board/tasks/<cardId>/chat/` 目录路径
 *
 * **Step 3 核对(task-catalog-transformation PRD)**:
 * 任务目录化后(ADR-0036 / Step 1),<cardId>.json 主数据从 tasksDir
 * 平铺迁移到 `<tasksDir>/<cardId>/<cardId>.json`,但 chat 子目录**保留**
 * 在 `<tasksDir>/<cardId>/chat/` 内 —— 本函数与 Step 1 改造前的路径**一致**,
 * 不需要改。SDK cwd 派生走 `TaskCardStore.cardDirFor`(任务目录本身),
 * 与 chat 子目录是两个独立维度:
 *
 * | 物理路径                      | 用途          | 派生 helper                |
 * |-------------------------------|---------------|----------------------------|
 * | `<tasksDir>/<cardId>/`        | SDK cwd       | TaskCardStore.cardDirFor   |
 * | `<tasksDir>/<cardId>/<id>.json` | 主数据        | TaskCardStore.cardPath     |
 * | `<tasksDir>/<cardId>/chat/`   | session 元数据 | **chatDirFor(本函数)**     |
 *
 * 这样 `delete` 时 `rm -rf <tasksDir>/<cardId>` 一次性清掉全部(主数据 +
 * transcript + chat session),而 session.json 物理位置保持稳定,不与
 * cwd 派生耦合。
 */
export function chatDirFor(
  workspaceRoot: string,
  requirementId: string,
  cardId: string,
): string {
  return join(
    workspaceRoot,
    'requirements',
    requirementId,
    'board',
    'tasks',
    cardId,
    'chat',
  )
}

/** session.json 物理路径 */
export function sessionJsonPathFor(
  workspaceRoot: string,
  requirementId: string,
  cardId: string,
): string {
  return join(chatDirFor(workspaceRoot, requirementId, cardId), 'session.json')
}

/**
 * SDK 会话日志 jsonl 路径(由 cwd 派生)——
 * Claude Code SDK 0.3.206 真实形态:`~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`。
 *
 * **SDK sanitize 规则**(2026-08-13 探底确证):
 * 1. 路径分隔符 `:` / `\` / `/` → `-`
 * 2. 任何非 `[A-Za-z0-9-]` 字符(含 CJK / `.` / 空格 ...)→ `-`
 *
 * 实例(用户实测,2026-08-13):
 *   cwd: `C:\Users\Lorcan\.aidevspace\requirements\req-003-这下可以了吧\board\tasks\<ulid>\chat`
 *   实际 dir: `C--Users-Lorcan--aidevspace-requirements-req-003--------board-tasks-<ulid>-chat`
 *
 * **早期误判**:本函数原用 `sha256(cwd).slice(0, 16)`,导致 `existsSync` 永远返 false
 * → `loadSnapshot` 永远走 `sdkJsonlMissing: true` 分支 → 跨刷新不渲染历史。
 * 修正后 existsSync 能命中真实 jsonl,snapshot events 数组会被填充。
 *
 * **Step 3 核对(task-catalog-transformation PRD)**:
 * SDK cwd 派生路径在 Step 2 后从 `<tasks>/<cardId>/chat` 变为
 * `<tasks>/<cardId>`(任务目录本身)。这意味着 SDK jsonl 物理路径
 * **会变** —— 老 workspace 的 jsonl 仍在 `projects/.../<cardId>-chat/`
 * 子目录下,Step 2 后新建的会话 jsonl 落在 `projects/.../<cardId>/` 下。
 *
 * 对老 session.json(`meta.cwd` 仍是 `<cardId>/chat`)→ 仍走老 jsonl 路径,
 * SDK resume 命中;对 Step 2 后新建的 session.json → 走新 jsonl 路径,干净。
 * 唯一「孤儿」场景:用户主动删 jsonl 或迁移 workspace 改变 cwd 字符串,
 * 由 `loadSnapshot.sdkJsonlMissing: true` 兜底,UI 渲染 banner,不阻断历史渲染。
 * —— 这是预期行为,无需特殊处理。
 */
export function sdkSessionLogPathFor(
  cwd: string,
  sessionId: string,
): string {
  const projectDir = sanitizeCwdForSdkProjectDir(cwd)
  return join(homedir(), '.claude', 'projects', projectDir, `${sessionId}.jsonl`)
}

/**
 * SDK 0.3.206 内部 project dir 命名规则:
 * 1. `[:\\/]` → `-`
 * 2. `[^A-Za-z0-9-]` → `-`
 *
 * 纯字符串操作,跟 cwd 长度一致(99 chars → 99 chars);无 hash。
 */
export function sanitizeCwdForSdkProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/]/g, '-').replace(/[^A-Za-z0-9-]/g, '-')
}

// ---------------------------------------------------------------------------
// 累计 usage 帮手
// ---------------------------------------------------------------------------

/** 0 累计 usage —— new session 默认值 */
export function zeroCumulativeUsage(): ChatCumulativeUsage {
  return ChatCumulativeUsageSchema.parse({
    cumulativeCostUsd: 0,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeCacheReadTokens: 0,
  })
}

/**
 * 累加 single-shot usage 到 cumulativeUsage —— 不修改原对象,返新对象。
 *
 * `costUsd` 与 `totalTokens` 来自 SDK `result` 消息;
 * `inputTokens` / `outputTokens` / `cacheReadTokens` 来自 result.usage 字段。
 * 本期实现:Provider 在 runChatQuery 末尾拿到 SDK result 后,把本次增量
 * 累加进 session.json.cumulativeUsage。
 */
export function accumulateUsage(
  prev: ChatCumulativeUsage,
  delta: {
    costUsd: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
  },
): ChatCumulativeUsage {
  return {
    cumulativeCostUsd: prev.cumulativeCostUsd + (delta.costUsd ?? 0),
    cumulativeInputTokens:
      prev.cumulativeInputTokens + (delta.inputTokens ?? 0),
    cumulativeOutputTokens:
      prev.cumulativeOutputTokens + (delta.outputTokens ?? 0),
    cumulativeCacheReadTokens:
      prev.cumulativeCacheReadTokens + (delta.cacheReadTokens ?? 0),
  }
}

// ---------------------------------------------------------------------------
// 依赖注入(测试可注入确定性时间 / ulid)
// ---------------------------------------------------------------------------

export interface ChatSessionServiceDeps {
  /** workspace 根路径(与 RequirementService.root 对齐) */
  workspaceRoot: string
  /** 时间源 —— 默认 `new Date().toISOString()` */
  nowIso?: () => string
  /**
   * SessionId 生成器 —— 测试可注入;默认 SDK 返回的 sessionId 由 Provider 透传。
   * 注:本服务不主动生成 sessionId;sessionId 由 SDK 首次 system/init 消息携带。
   */
  sessionIdGenerator?: () => string
  /** session.json 不可解析时的回调(便于上层日志);默认 console.warn */
  onCorruptSession?: (path: string, err: unknown) => void
  /**
   * SDK jsonl 单行损坏时的回调(便于上层日志);默认 console.warn。
   * 与 onCorruptSession 对称 —— 测试可注入收集器断言损坏行被记录。
   * 解析继续进行,损坏行被 silent skip(Q5 决议:不阻断 history 渲染)。
   */
  onCorruptJsonlLine?: (path: string, line: string, err: unknown) => void
}

// ---------------------------------------------------------------------------
// 主类
// ---------------------------------------------------------------------------

/**
 * ChatSessionService —— board chat session.json 持久化 + 生命周期管理。
 *
 * 单进程内状态:
 * - `locks`:严格单 tab lock —— Map<sessionKey, Promise<void>>;
 *   同 `(reqId, cardId)` in-flight query 第二次进 `getOrCreateSession` 时
 *   等待前一 query 完成(返回同一 sessionId),避免并发写撕裂 session.json。
 * - `metaCache`:本进程内已读 session.json 缓存(可选,降低重复 IO);
 *   默认不缓存(写后读由 caller 重新走 `get`)。
 *
 * 线程安全:Node 单线程,Map 操作天然安全。
 */
export class ChatSessionService {
  private readonly workspaceRoot: string
  private readonly nowIso: () => string
  private readonly onCorruptSession: (path: string, err: unknown) => void
  private readonly onCorruptJsonlLine: (
    path: string,
    line: string,
    err: unknown,
  ) => void
  /** 严格单 tab lock:`${reqId}::${cardId}` → in-flight Promise<ChatSessionMeta> */
  private readonly locks = new Map<string, Promise<ChatSessionMeta>>()

  constructor(deps: ChatSessionServiceDeps) {
    this.workspaceRoot = deps.workspaceRoot
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
    this.onCorruptSession =
      deps.onCorruptSession ??
      ((path, err) => {
        console.warn(`[ChatSessionService] corrupt session.json at ${path}:`, err)
      })
    this.onCorruptJsonlLine =
      deps.onCorruptJsonlLine ??
      ((path, line, err) => {
        console.warn(
          `[ChatSessionService] corrupt jsonl line at ${path}: ${line.slice(0, 80)}`,
          err,
        )
      })
  }

  // -------------------------------------------------------------------------
  // 路径(测试 + route 共享)
  // -------------------------------------------------------------------------

  /** 单 session chat 目录路径 */
  chatDir(requirementId: string, cardId: string): string {
    return chatDirFor(this.workspaceRoot, requirementId, cardId)
  }

  /** session.json 绝对路径 */
  sessionJsonPath(requirementId: string, cardId: string): string {
    return sessionJsonPathFor(this.workspaceRoot, requirementId, cardId)
  }

  /** req 目录是否存在 */
  requirementExists(requirementId: string): boolean {
    return existsSync(
      join(this.workspaceRoot, 'requirements', requirementId),
    )
  }

  // -------------------------------------------------------------------------
  // 读
  // -------------------------------------------------------------------------

  /**
   * 读 session.json;不存在 / 解析失败 → null。
   *
   * - 解析失败调用 onCorruptSession(便于上层日志),返 null
   * - 不会自动 fallback 重建(由 `getOrCreateSession` 决定是否重建)
   */
  get(requirementId: string, cardId: string): ChatSessionMeta | null {
    const path = this.sessionJsonPath(requirementId, cardId)
    if (!existsSync(path)) return null
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      this.onCorruptSession(path, err)
      return null
    }
    const validated = ChatSessionMetaSchema.safeParse(parsed)
    if (!validated.success) {
      this.onCorruptSession(path, validated.error)
      return null
    }
    return validated.data
  }

  // -------------------------------------------------------------------------
  // 写(atomic + fallback)
  // -------------------------------------------------------------------------

  /**
   * 原子写 session.json(tmp + rename)。
   * 失败抛 `E_IO` —— 由 caller 走 fallback(本方法不直接 fallback,
   * 让上层决定策略)。
   */
  writeMeta(requirementId: string, cardId: string, meta: ChatSessionMeta): void {
    const validated = ChatSessionMetaSchema.safeParse(meta)
    if (!validated.success) {
      throw new ChatSessionServiceError(
        'E_INVALID_SESSION',
        `session meta invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    const path = this.sessionJsonPath(requirementId, cardId)
    const dir = dirname(path)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    } catch (err) {
      throw new ChatSessionServiceError(
        'E_IO',
        `mkdir ${dir} failed: ${(err as Error).message}`,
      )
    }
    try {
      writeAtomic(path, JSON.stringify(validated.data, null, 2))
    } catch (err) {
      throw new ChatSessionServiceError(
        'E_IO',
        `write ${path} failed: ${(err as Error).message}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // getOrCreate + 单 tab lock
  // -------------------------------------------------------------------------

  /**
   * 读 session.json;不存在则用 SDK 提供的 sessionId 首次 query 落 session.json。
   *
   * 入参:`seed` —— 首次落盘时需要的最小信息(sdkSessionId / cwd /
   * additionalDirectories / model / permissionMode / mcpServers / ownerUserId)。
   *
   * **锁语义** —— 同 `(reqId, cardId)` 第二次调用:
   * 1. 若第一次调用进行中(还在走 SDK query 拿 sessionId),第二次会等待
   *    第一次落盘完成,返同一 sessionId。
   * 2. 若第一次调用已完成(已落盘),第二次直接走 `get` 路径。
   *
   * **写顺序契约** —— 首次落盘时机:Provider 拿到 SDK sessionId 后
   * (即 `system/init` 消息回调内)立即调用 `createSession(seed)`;
   * 中途失败 → 抛 `E_IO` → 上层走 fallback。
   */
  async getOrCreateSession(
    requirementId: string,
    cardId: string,
    seed: {
      sdkSessionId: string
      cwd: string
      additionalDirectories: ReadonlyArray<string>
      model: string
      permissionMode: ChatPermissionModeT
      mcpServers: ReadonlyArray<ChatMcpServerConfig>
      ownerUserId: string
    },
  ): Promise<ChatSessionMeta> {
    // req 目录必须存在(create 必依赖)
    if (!this.requirementExists(requirementId)) {
      throw new ChatSessionServiceError(
        'E_REQUIREMENT_NOT_FOUND',
        `requirement ${requirementId} not found`,
      )
    }
    const key = `${requirementId}::${cardId}`
    const existing = this.locks.get(key)
    if (existing) {
      // 同 (reqId, cardId) in-flight —— 等待前一 query 完成
      await existing
    }

    // 已有落盘 session.json?直接返(cwd 冻结守门由 Provider 层通过
    // `input.frozenCwd` 实现 —— RED 测试 8 锁定)
    const cur = this.get(requirementId, cardId)
    if (cur) {
      return cur
    }

    // 首次落盘:加锁 → 写 → 解锁
    const writePromise = this.#createAndWrite(requirementId, cardId, seed)
    this.locks.set(key, writePromise)
    try {
      return await writePromise
    } finally {
      this.locks.delete(key)
    }
  }

  /** 内部:同步创建 + 写 session.json(单次调用,锁由 caller 管理) */
  async #createAndWrite(
    requirementId: string,
    cardId: string,
    seed: {
      sdkSessionId: string
      cwd: string
      additionalDirectories: ReadonlyArray<string>
      model: string
      permissionMode: ChatPermissionModeT
      mcpServers: ReadonlyArray<ChatMcpServerConfig>
      ownerUserId: string
    },
  ): Promise<ChatSessionMeta> {
    const now = this.nowIso()
    const draft: ChatSessionMeta = {
      sessionId: seed.sdkSessionId,
      requirementId,
      cardId,
      cwd: seed.cwd,
      additionalDirectories: [...seed.additionalDirectories],
      model: seed.model,
      permissionMode: seed.permissionMode,
      // 字面常量;若 schema default 改成可配置,这里同步调整
      permissionPromptToolName: 'mcp__boardchat__user_confirm',
      mcpServers: [...seed.mcpServers],
      createdAt: now,
      lastQueryAt: now,
      queryCount: 1,
      ownerUserId: seed.ownerUserId,
      cumulativeUsage: zeroCumulativeUsage(),
      // issue 17 —— 新 session 的 SDK 侧会话尚未建立;首次 /query 传
      // newSessionId 让 SDK 用这个 UUID 建会话,成功后才置 true
      sdkSessionEstablished: false,
    }
    const validated = ChatSessionMetaSchema.safeParse(draft)
    if (!validated.success) {
      throw new ChatSessionServiceError(
        'E_INVALID_SESSION',
        `seed invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    this.writeMeta(requirementId, cardId, validated.data)
    return validated.data
  }

  // -------------------------------------------------------------------------
  // 字段 PATCH(白名单)
  // -------------------------------------------------------------------------

  /**
   * 字段白名单 PATCH —— 对照 ticket 03 验收:
   * model / permissionMode / mcpServers / additionalDirectories
   * + sdkSessionEstablished(issue 17)
   *
   * 不接受 sessionId / createdAt / cumulativeUsage(由 Provider 单独 update);
   * 改 model / permissionMode / mcpServers 后写盘,lastQueryAt 同步刷新。
   */
  patch(
    requirementId: string,
    cardId: string,
    patch: {
      cwd?: string
      additionalDirectories?: ReadonlyArray<string>
      model?: string
      permissionMode?: ChatPermissionModeT
      mcpServers?: ReadonlyArray<ChatMcpServerConfig>
      /** issue 17 —— SDK 侧会话已建立(首次 /query 建会话成功后置 true) */
      sdkSessionEstablished?: boolean
    },
  ): ChatSessionMeta {
    const cur = this.get(requirementId, cardId)
    if (!cur) {
      throw new ChatSessionServiceError(
        'E_INVALID_SESSION',
        `session not found for ${requirementId}/${cardId}`,
      )
    }
    const ts = this.nowIso()
    const next: ChatSessionMeta = {
      ...cur,
      ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
      ...(patch.additionalDirectories !== undefined
        ? { additionalDirectories: [...patch.additionalDirectories] }
        : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.permissionMode !== undefined
        ? { permissionMode: patch.permissionMode }
        : {}),
      ...(patch.mcpServers !== undefined
        ? { mcpServers: [...patch.mcpServers] }
        : {}),
      ...(patch.sdkSessionEstablished !== undefined
        ? { sdkSessionEstablished: patch.sdkSessionEstablished }
        : {}),
      lastQueryAt: ts,
    }
    const validated = ChatSessionMetaSchema.safeParse(next)
    if (!validated.success) {
      throw new ChatSessionServiceError(
        'E_INVALID_SESSION',
        `patch invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    this.writeMeta(requirementId, cardId, validated.data)
    return validated.data
  }

  // -------------------------------------------------------------------------
  // Reset / Delete —— issue 13 自愈路径
  // -------------------------------------------------------------------------

  /**
   * 删 stale session.json + audit/ 子目录 + SDK jsonl(issue 13 端到端自愈)。
   *
   * 触发场景:`/query` 调到已失效 sessionId 时(典型:`/start` 时
   * FakeChatProvider 落 `sdk-fake-001` 假 id,后续切真 Provider 再 `/query`
   * 真 SDK 找不到该 session,issue 13 根因),由 `/query` handler 自动调用,
   * 或 web 端收到 `chat_error { code: 'E_SESSION_EXPIRED' }` 后调
   * `POST /chat/sessions/reset` 触发。
   *
   * 物理清理:
   * - session.json → 先 rename 到 session.json.bak(兜底可回滚)
   * - chat/audit/ 目录 → 整目录删
   * - SDK jsonl(`~/.claude/projects/<hash>/<sid>.jsonl`)→ 删
   * - card 物理 dir 不动(card.json 等其他文件保留)
   *
   * 锁行为:不参与 queryLocks(lock 由 route 层管)。本方法本身是幂等的:
   * 多次调对不存在的 session.json / SDK jsonl 安全。
   *
   * @returns 清理摘要(给 caller 调试 / 日志用)
   */
  delete(
    requirementId: string,
    cardId: string,
  ): {
    sessionJson: 'renamed' | 'absent'
    auditDir: 'removed' | 'absent'
    sdkJsonl: 'removed' | 'absent'
  } {
    const sessionPath = this.sessionJsonPath(requirementId, cardId)
    let sessionJson: 'renamed' | 'absent' = 'absent'
    if (existsSync(sessionPath)) {
      // rename 到 .bak 兜底(误删可回滚)
      renameSync(sessionPath, `${sessionPath}.bak`)
      sessionJson = 'renamed'
    }

    // 删 chat/audit/ 子目录(若存在);issue 06 D16 物理独立,本方法一并清
    const chatDir = this.chatDir(requirementId, cardId)
    const auditDir = join(chatDir, 'audit')
    let auditDirResult: 'removed' | 'absent' = 'absent'
    if (existsSync(auditDir)) {
      rmSync(auditDir, { recursive: true, force: true })
      auditDirResult = 'removed'
    }

    // 删 SDK jsonl —— 必须先读 cwd + sessionId 才能派生路径,所以仅在
    // session.json 仍可读(.bak 之前)时尝试;若 .bak 不存在则跳过
    let sdkJsonl: 'removed' | 'absent' = 'absent'
    const bakPath = `${sessionPath}.bak`
    if (existsSync(bakPath)) {
      try {
        const raw = readFileSync(bakPath, 'utf8')
        const parsed = JSON.parse(raw) as {
          cwd?: string
          sessionId?: string
        }
        if (parsed.cwd && parsed.sessionId) {
          const sdkPath = sdkSessionLogPathFor(parsed.cwd, parsed.sessionId)
          if (existsSync(sdkPath)) {
            rmSync(sdkPath, { force: true })
            sdkJsonl = 'removed'
          }
        }
      } catch {
        /* 损坏 .bak 忽略 —— 不阻断 reset */
      }
    }

    // 进程级 cache 清掉(避免 chatSessionService.get 仍返 stale meta)
    // chat dir 物理仍存在,只要 session.json 不在 get() 就会返 null
    return { sessionJson, auditDir: auditDirResult, sdkJsonl }
  }

  // -------------------------------------------------------------------------
  // Cost 累计 + queryCount
  // -------------------------------------------------------------------------

  /**
   * 累加 SDK result usage + 刷新 lastQueryAt / queryCount。
   *
   * Provider 在拿到 SDK result 消息后调用;cumulativeUsage 单调递增,
   * 失败抛 `E_INVALID_SESSION`(上层应 capture 而不阻断业务流)。
   */
  recordUsage(
    requirementId: string,
    cardId: string,
    delta: {
      costUsd: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
    },
  ): ChatSessionMeta {
    const cur = this.get(requirementId, cardId)
    if (!cur) {
      throw new ChatSessionServiceError(
        'E_INVALID_SESSION',
        `session not found for ${requirementId}/${cardId}`,
      )
    }
    const ts = this.nowIso()
    const next: ChatSessionMeta = {
      ...cur,
      lastQueryAt: ts,
      queryCount: cur.queryCount + 1,
      cumulativeUsage: accumulateUsage(cur.cumulativeUsage, delta),
    }
    const validated = ChatSessionMetaSchema.safeParse(next)
    if (!validated.success) {
      throw new ChatSessionServiceError(
        'E_INVALID_SESSION',
        `recordUsage invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    this.writeMeta(requirementId, cardId, validated.data)
    return validated.data
  }

  // -------------------------------------------------------------------------
  // 30 天 SDK 健康检查(ADR-0029 D16)
  // -------------------------------------------------------------------------

  /**
   * 30 天 SDK 健康检查 —— session.json 中 SDK 会话日志路径(existsSync);
   * 缺失返回 `needs-rebuild: true`,由上层决定下次 query 走 rebuild 路径。
   *
   * 30 天阈值:落地判定 `lastQueryAt` 与当前时间的差;超过 30 天的
   * session,即便 SDK jsonl 还在也建议 rebuild —— 但本期简化版只
   * 判定 SDK jsonl 是否存在(`existsSync`),超过 30 天自动清空
   * sessionId 字段(下次 query 拿新 sessionId 重建)。
   *
   * @returns `{ needsRebuild: boolean, reason: string }` —— 便于上层日志
   */
  healthCheck(
    requirementId: string,
    cardId: string,
    options?: { nowMs?: number; ttlDays?: number },
  ): { needsRebuild: boolean; reason: string } {
    const ttlDays = options?.ttlDays ?? 30
    const nowMs = options?.nowMs ?? Date.now()
    const meta = this.get(requirementId, cardId)
    if (!meta) {
      return { needsRebuild: false, reason: 'no-session' }
    }
    // 1. 30 天阈值(优先:即便 SDK jsonl 在,超过 30 天也建议 rebuild)
    const lastMs = Date.parse(meta.lastQueryAt)
    if (Number.isFinite(lastMs)) {
      const ageDays = (nowMs - lastMs) / (1000 * 60 * 60 * 24)
      if (ageDays > ttlDays) {
        return { needsRebuild: true, reason: 'session-older-than-30-days' }
      }
    }
    // 2. SDK jsonl 路径缺失(30 天内但 jsonl 丢失)
    const sdkLogPath = sdkSessionLogPathFor(meta.cwd, meta.sessionId)
    if (!existsSync(sdkLogPath)) {
      return { needsRebuild: true, reason: 'sdk-jsonl-missing' }
    }
    return { needsRebuild: false, reason: 'healthy' }
  }

  /**
   * 30 天 sweep —— 遍历指定 req 下所有 TaskCard 的 chat session,
   * 删除超过 ttl 天的 sessionId 字段(由下次 query 拿新 sessionId 重建)。
   *
   * 实现:扫描 `board/tasks/<cardId>/chat/session.json` —— 物理路径与
   * ChatSessionService 落盘契约对齐。每张 TaskCard 的 chat/ 目录独立,
   * 即使 TaskCardStore 的 <cardId>.json 不存在,chat session 也可能存在
   * (chat session 早于 TaskCard 创建的边界场景)。
   *
   * **Step 3 核对(task-catalog-transformation PRD)**:任务目录化后
   * (ADR-0036 / Step 1),tasksDir 下从平铺 `<id>.json` 变成子目录
   * `<cardId>/`。本函数扫描 `tasksDir/<name>/chat/`,语义**仍然正确** —
   * `name` 直接当 cardId 拼接 chat 子目录即可,无需 `withFileTypes` 过滤
   * (L723 `existsSync(chatDir)` 会过滤掉非 cardDir 的项,例如残留的
   * `<cardId>.json` 老 workspace 平铺文件)。边界情况已验证:见
   * `chat-session-service.test.ts` "sweepExpiredSessions:多 card 时各自
   * 独立 sweep" 回归测试。
   *
   * 注:本期实现为简化版 —— 不直接删 session.json,而是把 `sessionId` 清空 +
   * `cumulativeUsage` 重置;目录 + 元数据保留(cwd / additionalDirectories 等
   * 不变),方便下次 query 走同 cwd 重建。
   *
   * @returns sweep 计数
   */
  sweepExpiredSessions(
    requirementId: string,
    options?: { nowMs?: number; ttlDays?: number },
  ): { swept: number; skipped: number } {
    const ttlDays = options?.ttlDays ?? 30
    const nowMs = options?.nowMs ?? Date.now()
    const tasksDir = join(
      this.workspaceRoot,
      'requirements',
      requirementId,
      'board',
      'tasks',
    )
    if (!existsSync(tasksDir)) return { swept: 0, skipped: 0 }
    let swept = 0
    let skipped = 0
    let names: string[]
    try {
      names = readdirSync(tasksDir)
    } catch {
      return { swept: 0, skipped: 0 }
    }
    for (const name of names) {
      // 只扫目录(每张 TaskCard 一个独立 chat/ 子目录)
      const cardId = name
      const chatDir = join(tasksDir, cardId, 'chat')
      if (!existsSync(chatDir)) continue
      const meta = this.get(requirementId, cardId)
      if (!meta) {
        skipped += 1
        continue
      }
      const lastMs = Date.parse(meta.lastQueryAt)
      if (!Number.isFinite(lastMs)) {
        skipped += 1
        continue
      }
      const ageDays = (nowMs - lastMs) / (1000 * 60 * 60 * 24)
      if (ageDays <= ttlDays) {
        skipped += 1
        continue
      }
      // 重置 cumulativeUsage + queryCount(sessionId 保留;下次 query 通过
      // healthCheck 检测 SDK jsonl 缺失 → 走 rebuild 路径拿新 sessionId)
      const reset: ChatSessionMeta = {
        ...meta,
        queryCount: 0,
        cumulativeUsage: zeroCumulativeUsage(),
        lastQueryAt: this.nowIso(),
      }
      this.writeMeta(requirementId, cardId, reset)
      swept += 1
    }
    return { swept, skipped }
  }

  // -------------------------------------------------------------------------
  // Snapshot → messages 数组(ADR-0029 D9)
  // -------------------------------------------------------------------------

  /**
   * 构造 ChatSessionSnapshotResponse —— meta + events + sdkJsonlMissing 标志。
   *
   * - `meta` —— session.json 元数据(session 不存在时为 null,UI 走空态)
   * - `events` —— 从 SDK jsonl 解析的历史事件;详见 `parseSdkSessionLog` 注释
   * - `sdkJsonlMissing` —— session.json 存在但 SDK jsonl(`~/.claude/projects/<hash>/<sid>.jsonl`)
   *   缺失(30 天 sweep / 手动删 / workspace 移动后 hash 变化);UI 据此渲染
   *   "⚠️ SDK 会话日志丢失" banner,与"从未聊过"(events:[] + meta:null)区分开。
   *
   * 注:Snapshot 解析不进入 chat 单 tab lock —— 这是只读操作,可以并行。
   * 当前实现为同步 IO;若 SDK jsonl 体积变大,后续可包成 async + worker 线程。
   */
  loadSnapshot(
    requirementId: string,
    cardId: string,
  ): {
    meta: ChatSessionMeta | null
    events: ChatSessionEvent[]
    sdkJsonlMissing: boolean
  } {
    const meta = this.get(requirementId, cardId)
    if (!meta) return { meta: null, events: [], sdkJsonlMissing: false }
    const sdkPath = sdkSessionLogPathFor(meta.cwd, meta.sessionId)
    if (!existsSync(sdkPath)) {
      return { meta, events: [], sdkJsonlMissing: true }
    }
    const events = parseSdkSessionLog(sdkPath, this.onCorruptJsonlLine)
    return { meta, events, sdkJsonlMissing: false }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** atomic 写文件(tmp + rename) —— session.json 含 ownerUserId + 累计 cost,
 * 沿用 TaskCardStore.writeFile 模式(mode 0o600 / 0o700)做权限收紧 */
function writeAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, target)
}

/**
 * 从 SDK 会话日志 jsonl 解析历史事件(本期实现 —— ADR-0029 D9a 修订后)。
 *
 * SDK 2.1.206 jsonl 真形态(用户实测,2026-08-13):
 * - `{type: 'system', subtype: 'init', session_id, cwd, model}` —— **不保证存在**
 *   (D9a 探底确证 SDK 0.3.206 不在 user-facing stream emit init;SDK 2.1.206
 *   持久化到 jsonl 时也可能不写 init 行 —— `/start` 走纯本地 + 首次 `/query`
 *   触发建会话的场景下,真实 jsonl 第 1 行就是 `type: 'user'`)
 * - `{type: 'user', timestamp, message: {role:'user', content:[{type:'text', text}]}}`
 *   —— SDK 2.1.206 **总是带** timestamp 字段(ISO 字符串;与 SDK 0.3.206 注释
 *   "Older emitters omit it" 不一致,以实测为准)
 * - `{type: 'assistant', timestamp?, message: {role:'assistant', content:[...]}}`
 *   —— SDK 2.1.206 实际带 timestamp
 * - `{type: 'last-prompt', lastPrompt, leafUuid, sessionId}` —— 本期不解析
 * - `{type: 'result', ...}` —— 本期不解析(Q3 范围外)
 *
 * 解析策略(Q1-Q5 决议 + 2026-08-13 全局复盘):
 * 1. JSON.parse 失败 → 调 `onCorruptJsonlLine` + silent skip(Q5-5a)
 * 2. **不预设 init 行** —— `system/init` 存在则 skip(仅供调试),不存在不阻断;
 *    所有 `type: 'user' | 'assistant' | 'last-prompt' | 'result' | 'error' ...`
 *    按 type 无条件 dispatch(sawInit gate 已于 2026-08-13 拆掉)
 * 3. user 消息 `ts`:读 `parsed.timestamp`(ISO)→ `Date.parse`;缺省 → `Date.now()`(Q4-A)
 * 4. assistant 消息 `ts`:SDK 2.1.206 实际带 `timestamp`,用同样策略;0.3.206 不带则 fallback(Q4-A)
 * 5. assistant 单条消息含 text/thinking/tool_use 混合 → 1 条 `chat_message_assistant`,
 *    content 数组按 jsonl 顺序;**纯 tool_use**(无 text/thinking)→ 每块拆 1 条
 *    `chat_tool_call`(Q3-B + UI 跟 Live 形态对齐)
 * 6. user 消息含 tool_result → 1 条 `chat_tool_result`(Q3-B;
 *    `ChatMessageUserContentSchema` 不接受 tool_result block,所以必须单算)
 * 7. 我们自己的 SSE event(`kind: 'chat_permission_*'`)也接受:维护 pendingRequestIds,
 *    循环结束后对未配对的 request 各注入 1 条 synthetic `chat_permission_resolved`
 *    `{ decision: { decision: 'deny', reason: 'session-interrupted' } }`(Q5-3a)
 * 8. 未知 `kind` / 未知 `type` → 调 `onCorruptJsonlLine` + skip
 *
 * @param sdkLogPath SDK 会话日志 jsonl 绝对路径
 * @param onCorruptJsonlLine 单行损坏回调(Q5-5a + 测试可注入收集器)
 * @returns ChatSessionEvent[] —— 顺序与 jsonl 一致(尾部追加 synthetic resolved)
 */
export function parseSdkSessionLog(
  sdkLogPath: string,
  onCorruptJsonlLine?: (path: string, line: string, err: unknown) => void,
): ChatSessionEvent[] {
  if (!existsSync(sdkLogPath)) return []
  let raw: string
  try {
    raw = readFileSync(sdkLogPath, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const out: ChatSessionEvent[] = []
  const pendingRequestIds = new Set<string>()

  for (const line of lines) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch (err) {
      onCorruptJsonlLine?.(sdkLogPath, line, err)
      continue
    }

    // -- Branch A:我们自己的 SSE event(以 `kind: 'chat_*'` 形态出现) --
    const kind = parsed['kind']
    if (typeof kind === 'string') {
      if (kind === 'chat_permission_request') {
        const requestId =
          typeof parsed['requestId'] === 'string' ? parsed['requestId'] : ''
        if (requestId) pendingRequestIds.add(requestId)
        // schema 要求 `input: Record<string, unknown>`;parsed['input'] 是 unknown,窄化为 record
        const rawInput = parsed['input']
        const input: Record<string, unknown> =
          rawInput !== null && typeof rawInput === 'object'
            ? (rawInput as Record<string, unknown>)
            : {}
        out.push({
          kind: 'chat_permission_request',
          ts: Date.now(),
          requestId,
          toolName:
            typeof parsed['toolName'] === 'string' ? parsed['toolName'] : '',
          input,
          displayName:
            typeof parsed['displayName'] === 'string'
              ? parsed['displayName']
              : undefined,
          title: typeof parsed['title'] === 'string' ? parsed['title'] : undefined,
          description:
            typeof parsed['description'] === 'string'
              ? parsed['description']
              : undefined,
        })
        continue
      }
      if (kind === 'chat_permission_resolved') {
        const requestId =
          typeof parsed['requestId'] === 'string' ? parsed['requestId'] : ''
        if (requestId) pendingRequestIds.delete(requestId)
        const decisionObj =
          parsed['decision'] &&
          typeof parsed['decision'] === 'object' &&
          parsed['decision'] !== null
            ? (parsed['decision'] as Record<string, unknown>)
            : {}
        const decisionLiteral =
          decisionObj['decision'] === 'deny' ? 'deny' : 'allow'
        const reason =
          typeof decisionObj['reason'] === 'string'
            ? decisionObj['reason']
            : undefined
        out.push({
          kind: 'chat_permission_resolved',
          ts: Date.now(),
          requestId,
          decision: { decision: decisionLiteral, reason },
        })
        continue
      }
      // 未知 chat_* kind:记 warn + skip(不影响 history 渲染)
      onCorruptJsonlLine?.(
        sdkLogPath,
        line,
        new Error(`unknown event kind: ${kind}`),
      )
      continue
    }

    // -- Branch B:SDK 事件(以 `type: ...` 形态出现) --
    const type = parsed['type']
    if (type === 'system' && parsed['subtype'] === 'init') {
      // init 自身不解析为 event(init 不是稳定契约 —— SDK 2.1.206 真实 jsonl
      // 不一定写 system/init;此行仅供调试,不构成后续事件的 gate)。
      // 历史上曾用 sawInit gate 跳过 init 之前的事件(commit before 2026-08-13),
      // 但用户实测 jsonl 根本没有 init 行,导致全部 user/assistant 被 skip →
      // events=[];现已拆掉 gate,所有 SDK 事件按 type 无条件 dispatch。
      continue
    }

    // --- user 消息 ---
    if (type === 'user') {
      const message = parsed['message'] as { content?: unknown } | undefined
      const content = message?.content
      if (!Array.isArray(content)) continue
      const userBlocks: Array<
        | { kind: 'text'; text: string }
        | { kind: 'attachment'; url: string; name?: string }
      > = []
      const toolResultEvents: Array<{
        id: string
        name: string
        content: unknown
        isError: boolean
        ts: number
      }> = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        // text 块要求 length>0 —— `ChatMessageUserContentSchema.text` 是
        // `z.string().min(1)`,若 SDK 写出空 text(实测 SDK 2.1.206 在
        // tool_result-only user 消息 / 内部 marker 场景会写 `text: ''`),
        // 此处不 push,否则后续 snapshot 端 zod parse 会 500。
        if (
          b['type'] === 'text' &&
          typeof b['text'] === 'string' &&
          b['text'].length > 0
        ) {
          userBlocks.push({ kind: 'text', text: b['text'] })
        } else if (
          b['type'] === 'tool_result' &&
          typeof b['tool_use_id'] === 'string'
        ) {
          // tool_result 不进 chat_message_user.content(Schema 不接受);单算 chat_tool_result
          const toolUseId = b['tool_use_id']
          const toolName =
            typeof b['name'] === 'string' ? b['name'] : '(unknown)'
          toolResultEvents.push({
            id: toolUseId,
            name: toolName,
            content: b['content'],
            isError: b['is_error'] === true,
            ts: parseSdkTimestamp(parsed, sdkLogPath, line, onCorruptJsonlLine),
          })
        }
      }
      // 决定 ts:user 消息的 ts 对所有派生 events 共用(SDK jsonl 只有 1 个 timestamp)
      const userTs = parseSdkTimestamp(parsed, sdkLogPath, line, onCorruptJsonlLine)
      // tool_result 单独 emit
      for (const tr of toolResultEvents) {
        out.push({
          kind: 'chat_tool_result',
          ts: userTs,
          id: tr.id,
          name: tr.name,
          content: tr.content,
          isError: tr.isError,
        })
      }
      // user text/attachment → 1 条 chat_message_user
      if (userBlocks.length > 0) {
        out.push({
          kind: 'chat_message_user',
          ts: userTs,
          content: userBlocks,
        })
      }
      continue
    }

    // --- assistant 消息 ---
    if (type === 'assistant') {
      const message = parsed['message'] as { content?: unknown } | undefined
      const content = message?.content
      if (!Array.isArray(content)) continue
      const assistantBlocks: Array<
        | { kind: 'text'; text: string }
        | { kind: 'thinking'; text: string }
        | { kind: 'tool_use'; toolUseId: string; name: string; input: Record<string, unknown> }
      > = []
      const toolCallEvents: Array<{
        id: string
        name: string
        input: unknown
      }> = []
      let hasNonToolUse = false
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        // 同 user 解析:空 text/thinking 块跳过(无 UI 价值;assistant schema
        // 允许空,但保持 user/assistant 行为一致,避免空块被 snapshot 推给 web 端)。
        if (
          b['type'] === 'text' &&
          typeof b['text'] === 'string' &&
          b['text'].length > 0
        ) {
          assistantBlocks.push({ kind: 'text', text: b['text'] })
          hasNonToolUse = true
        } else if (
          b['type'] === 'thinking' &&
          typeof b['thinking'] === 'string' &&
          b['thinking'].length > 0
        ) {
          assistantBlocks.push({ kind: 'thinking', text: b['thinking'] })
          hasNonToolUse = true
        } else if (
          b['type'] === 'tool_use' &&
          typeof b['id'] === 'string' &&
          typeof b['name'] === 'string'
        ) {
          const rawToolInput = b['input']
          const toolInput: Record<string, unknown> =
            rawToolInput !== null && typeof rawToolInput === 'object'
              ? (rawToolInput as Record<string, unknown>)
              : {}
          assistantBlocks.push({
            kind: 'tool_use',
            toolUseId: b['id'],
            name: b['name'],
            input: toolInput,
          })
          toolCallEvents.push({
            id: b['id'],
            name: b['name'],
            input: toolInput,
          })
        }
      }
      const asstTs = parseSdkTimestamp(parsed, sdkLogPath, line, onCorruptJsonlLine) // SDK 2.1.206 实测带 timestamp;0.3.206 不带 → fallback Date.now()
      if (!hasNonToolUse && toolCallEvents.length > 0) {
        // 纯 tool_use:每块拆 1 条 chat_tool_call
        for (const tc of toolCallEvents) {
          out.push({
            kind: 'chat_tool_call',
            ts: asstTs,
            id: tc.id,
            name: tc.name,
            args: tc.input as Record<string, unknown>,
            partial: false,
          })
        }
      } else if (assistantBlocks.length > 0) {
        // 含 text/thinking(可能 +tool_use)→ 1 条 chat_message_assistant
        out.push({
          kind: 'chat_message_assistant',
          ts: asstTs,
          content: assistantBlocks,
        })
      }
      continue
    }

    // result / error / 其它 SDK type:本期不解析(Q3 范围外)—— skip
    continue
  }

  // 注入 synthetic chat_permission_resolved(Q5-3a):
  // 对未配对的 permission_request,加一条 decision=deny reason=session-interrupted
  for (const requestId of pendingRequestIds) {
    out.push({
      kind: 'chat_permission_resolved',
      ts: Date.now(),
      requestId,
      decision: { decision: 'deny', reason: 'session-interrupted' },
    })
  }

  return out
}

/**
 * 从 SDK 消息行顶层 `timestamp` 字段读 ISO 字符串并解析为 epoch ms。
 * 缺省 / 解析失败 → fallback `Date.now()`(Q4-A);失败时同时调 onCorruptJsonlLine
 * 记录 warn(但不让其阻断 history 渲染 —— Q5-5a silent skip 原则)。
 */
function parseSdkTimestamp(
  parsed: Record<string, unknown>,
  sdkLogPath: string,
  line: string,
  onCorruptJsonlLine?: (path: string, line: string, err: unknown) => void,
): number {
  const tsField = parsed['timestamp']
  if (typeof tsField === 'string') {
    const ms = Date.parse(tsField)
    if (Number.isFinite(ms)) return ms
    onCorruptJsonlLine?.(
      sdkLogPath,
      line,
      new Error(`unparseable timestamp: ${tsField}`),
    )
  }
  return Date.now()
}

/** 默认 permission mode(用于 seed 缺省值) */
export const DEFAULT_PERMISSION_MODE: ChatPermissionModeT =
  ChatPermissionMode.DEFAULT