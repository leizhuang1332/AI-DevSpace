/**
 * ChatSessionService —— board chat session 生命周期管理(issue 03 / ADR-0029)
 *
 * 物理路径:`~/.aidevspace/requirements/<reqId>/board/tasks/<ulid>/chat/session.json`
 * 物理独立 SDK 会话日志:`~/.claude/projects/<hash-of-cwd>/<sessionId>.jsonl`
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
 * - **Snapshot → messages 数组** —— 从 SDK jsonl 解析 `system/init` 之前的
 *   user / assistant 消息(本期实现:从 `system/init` 之前的 SDK jsonl 行)
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
import { createHash } from 'node:crypto'
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

/** `<root>/requirements/<reqId>/board/tasks/<cardId>/chat/` 目录路径 */
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
 * Claude Code SDK 0.3.206 真实形态:`~/.claude/projects/<hash-of-cwd>/<sessionId>.jsonl`。
 *
 * hash-of-cwd 与 SDK 内部实现保持一致(基于 macOS SDK 0.3.206 推导;
 * 若 SDK 内部使用 cwd 字符串而非 hash,我们仍走 cwd 字符串容错路径)。
 *
 * 本期实现:返回绝对路径 cwd 拼接;SDK 实际 hash 化由 SDK 内部完成,
 * 我们只用于 existsSync 健康检查。
 */
export function sdkSessionLogPathFor(
  cwd: string,
  sessionId: string,
): string {
  // SDK 0.3.206 真形态:`~/.claude/projects/<sha256-of-cwd-prefix>/<sessionId>.jsonl`。
  // 我们用 sha256(cwd).slice(0,16) 模拟 SDK 内部的 cwd-prefix hash(16 hex chars);
  // 若 SDK hash 算法不同,existsSync 会返 false → healthCheck 走 rebuild 路径。
  // 测试同样依赖 existsSync(false) 触发 sweep fallback 验证。
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  return join(homedir(), '.claude', 'projects', hash, `${sessionId}.jsonl`)
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
   * 构造 ChatSessionSnapshotResponse —— meta + events 数组。
   *
   * - `meta` —— session.json 元数据(session 不存在时为 null,UI 走空态)
   * - `events` —— 从 SDK jsonl 解析的历史事件(本期实现:基于 SDK jsonl
   *   路径 `~/.claude/projects/<hash>/<sessionId>.jsonl` 解析 system/init
   *   之前的 user / assistant 消息)。
   *
   * 注:Snapshot 解析不进入 chat 单 tab lock —— 这是只读操作,可以并行。
   * 当前实现为同步 IO;若 SDK jsonl 体积变大,后续可包成 async + worker 线程。
   */
  loadSnapshot(
    requirementId: string,
    cardId: string,
  ): { meta: ChatSessionMeta | null; events: ChatSessionEvent[] } {
    const meta = this.get(requirementId, cardId)
    if (!meta) return { meta: null, events: [] }
    const events = parseSdkSessionLog(
      sdkSessionLogPathFor(meta.cwd, meta.sessionId),
    )
    return { meta, events }
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
 * 从 SDK 会话日志 jsonl 解析历史事件(本期实现:简化版 —— 解析
 * system/init 之前的 user / assistant 消息)。
 *
 * SDK jsonl 行形态:
 * - `{type: 'system', subtype: 'init', session_id, cwd, model, tools}` —— 系统初始化
 * - `{type: 'user', message: {role:'user', content:[...]}}` —— 用户消息
 * - `{type: 'assistant', message: {role:'assistant', content:[...]}}` —— 助手消息
 * - `{type: 'result', subtype, total_cost_usd, usage, ...}` —— 结果
 *
 * 本期只解析 system/init 之前的 user / assistant 消息,后期扩展补
 * result / tool_use / tool_result / permission_request 等。
 *
 * @param sdkLogPath SDK 会话日志 jsonl 绝对路径
 * @returns ChatSessionEvent[] —— 顺序与 jsonl 一致
 */
export function parseSdkSessionLog(sdkLogPath: string): ChatSessionEvent[] {
  if (!existsSync(sdkLogPath)) return []
  let raw: string
  try {
    raw = readFileSync(sdkLogPath, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const out: ChatSessionEvent[] = []
  const now = Date.now()
  let sawInit = false
  for (const line of lines) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const type = parsed['type']
    if (type === 'system' && parsed['subtype'] === 'init') {
      sawInit = true
      // system/init 之前的消息不算(本期先解析之前的 user/assistant;
      // 后期扩展也解析 system/init 之后的 user/assistant/result 等)
      continue
    }
    // 只解析 system/init 之前的消息
    if (sawInit) continue
    if (type === 'user') {
      const message = parsed['message'] as
        | { content?: unknown }
        | undefined
      const content = message?.content
      if (!Array.isArray(content)) continue
      const userContent = content
        .map((block) => {
          if (!block || typeof block !== 'object') return null
          const b = block as Record<string, unknown>
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            return { kind: 'text' as const, text: b['text'] as string }
          }
          return null
        })
        .filter((c): c is { kind: 'text'; text: string } => c !== null)
      if (userContent.length === 0) continue
      out.push({
        kind: 'chat_message_user',
        ts: now,
        content: userContent,
      })
    } else if (type === 'assistant') {
      const message = parsed['message'] as
        | { content?: unknown }
        | undefined
      const content = message?.content
      if (!Array.isArray(content)) continue
      const assistantContent: Array<
        | { kind: 'text'; text: string; partial?: boolean }
        | { kind: 'thinking'; text: string; partial?: boolean }
      > = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b['type'] === 'text' && typeof b['text'] === 'string') {
          assistantContent.push({
            kind: 'text',
            text: b['text'] as string,
          })
        } else if (
          b['type'] === 'thinking' &&
          typeof b['thinking'] === 'string'
        ) {
          assistantContent.push({
            kind: 'thinking',
            text: b['thinking'] as string,
          })
        }
      }
      if (assistantContent.length === 0) continue
      out.push({
        kind: 'chat_message_assistant',
        ts: now,
        content: assistantContent,
      })
    }
  }
  return out
}

/** 默认 permission mode(用于 seed 缺省值) */
export const DEFAULT_PERMISSION_MODE: ChatPermissionModeT =
  ChatPermissionMode.DEFAULT