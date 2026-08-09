/**
 * AuditLogWriter —— board chat 独立 audit log 服务(issue 06 / ADR-0029 D16)
 *
 * 物理路径:`~/.aidevspace/audit/<reqId>/<cardId>/chat.log` —— JSONL,
 * 跟 session.json 完全物理隔离,跟 Run 体系 audit 也不混淆(chat ≠ Run)。
 *
 * 设计要点(对应 ADR-0029 D16 + ticket 06):
 * - **8 项字段 schema** —— `ts / toolName / toolUseId / args / result /
 *   decision / decidedBy / durationMs`,通过 `ChatToolAuditSchema` 落盘前校验
 *   (shared);落盘失败抛 `AuditLogWriterError` (上层 capture,不影响业务流)
 * - **5 决定者维度** —— `user / auto-allow-toggle / bypassPermissions /
 *   timeout / deny-pattern`(`ChatAuditDecidedBySchema`);工具调用的决议
 *   主体按这 5 种分类,audit log 提供完整 5 维审计痕迹
 * - **Atomic write** —— tmp + rename,避免权限 prompt / 工具执行链路中的
 *   并发写撕裂 chat.log;失败抛 `E_IO`
 * - **30 天 sweep** —— `sweepExpiredAuditLogs(workspaceRoot, reqId, options)`;
 *   调用方按跟 SDK session 同步频率跑(本期不挂 timer,Service 层 hook 调用)
 * - **跟 session.json 物理隔离** —— 路径完全派生自
 *   `(workspaceRoot, reqId, cardId)`,不读 session.json,不依赖 cwd /
 *   sessionId / model 等字段
 *
 * 守门契约(ADR-0023):
 * - audit 写盘不影响 chat session 业务流(异常仅日志,fallback 通过 caller 处理)
 * - 不进入 Analysis Run 闭包(`runAnalysisQuery` / `createSdkMcpServer`)
 *
 * 设计取舍(本 ticket 内决策):
 * - **追加模式,非读改写** —— JSONL 顺序追加,tmp+rename 整文件落;
 *   并发写仍安全(同一 inode rename 原子)。不引入文件锁(简化 + 跨进程
 *   无依赖)
 * - **sweep 独立函数** —— 不挂在 constructor 内的 setInterval(可测试 +
 *   易控生命周期);调用方负责注册
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { ChatToolAuditSchema, type ChatToolAudit } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** AuditLogWriter 失败时抛错;code 与 HTTP 状态码映射由 route 层决定。 */
export class AuditLogWriterError extends Error {
  constructor(
    public readonly code: 'E_INVALID_ENTRY' | 'E_IO',
    message: string,
  ) {
    super(message)
    this.name = 'AuditLogWriterError'
  }
}

// ---------------------------------------------------------------------------
// 路径 helper(单点真相,test + 路由共享)
// ---------------------------------------------------------------------------

/**
 * `<workspaceRoot>/audit/<reqId>/<cardId>/chat.log` 物理路径。
 *
 * `workspaceRoot` 是 `~/.aidevspace` —— Agent 在常规 workspace 之外
 * 的全局用户配置根(由 server bootstrap 决定,跟 RequirementService 的
 * `workspaceRoot` 概念独立)。
 */
export function auditPathFor(
  workspaceRoot: string,
  requirementId: string,
  cardId: string,
): string {
  return join(workspaceRoot, 'audit', requirementId, cardId, 'chat.log')
}

// ---------------------------------------------------------------------------
// 依赖注入
// ---------------------------------------------------------------------------

export interface AuditLogWriterDeps {
  /** `~/.aidevspace` 根路径(Agent 全局用户配置根) */
  workspaceRoot: string
  /**
   * 单条 entry 落盘回调(便于上层注入 metrics / log)—— 失败也调用,
   * 上层按需聚合
   */
  onWrite?: (path: string, entry: ChatToolAudit) => void
}

// ---------------------------------------------------------------------------
// 主类
// ---------------------------------------------------------------------------

/**
 * AuditLogWriter —— 8 字段 entry JSONL 落盘。
 *
 * 写盘语义:
 * - 先 zod parse `ChatToolAuditSchema`(失败抛 `E_INVALID_ENTRY`)
 * - 父目录 `audit/<reqId>/<cardId>/` 不存在 → `mkdirSync({recursive: true})`
 * - tmp 文件 + writeFileSync(0o600) + renameSync 原子替换 chat.log
 * - 单行 JSONL:一行一条 record,带末尾换行(`\n`)
 * - 失败抛 `AuditLogWriterError`,上层 capture 不影响业务流
 *
 * 线程安全:Node 单线程,writeFileSync + renameSync 串行安全。
 * 跨进程:同一 `(reqId, cardId)` 两个进程并发写最后会覆盖(tmp+rename 的
 * "last-writer-wins" 语义)—— audit log 是 30 天 sweep 文件,不是高频
 * 关键状态,允许最终一致性。
 */
export class AuditLogWriter {
  private readonly workspaceRoot: string
  private readonly onWrite: (path: string, entry: ChatToolAudit) => void

  constructor(deps: AuditLogWriterDeps) {
    this.workspaceRoot = deps.workspaceRoot
    this.onWrite =
      deps.onWrite ??
      (() => {
        // 默认空操作 —— audit 失败不影响业务流
      })
  }

  /** audit log 文件路径(便于测试 + 路由集成) */
  pathFor(requirementId: string, cardId: string): string {
    return auditPathFor(this.workspaceRoot, requirementId, cardId)
  }

  /**
   * 追加一行 JSONL 到 `audit/<reqId>/<cardId>/chat.log`。
   *
   * - 8 字段 schema 由 `ChatToolAuditSchema` 校验(shared)
   * - 父目录不存在 → 自动 `mkdirSync({recursive: true})`
   * - atomic:tmp + rename 整文件替换(避免撕裂)
   * - 失败抛 `AuditLogWriterError`(上层 capture fallback)
   */
  writeAuditEntry(
    requirementId: string,
    cardId: string,
    entry: ChatToolAudit,
  ): void {
    const validated = ChatToolAuditSchema.safeParse(entry)
    if (!validated.success) {
      throw new AuditLogWriterError(
        'E_INVALID_ENTRY',
        `audit entry invalid: ${validated.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`,
      )
    }
    const path = auditPathFor(this.workspaceRoot, requirementId, cardId)
    const dir = dirname(path)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    } catch (err) {
      throw new AuditLogWriterError(
        'E_IO',
        `mkdir ${dir} failed: ${(err as Error).message}`,
      )
    }

    // 读已有内容 → 追加新行 → tmp + rename(整文件 IO)
    let existing = ''
    if (existsSync(path)) {
      try {
        existing = readFileOrEmpty(path)
      } catch (err) {
        throw new AuditLogWriterError(
          'E_IO',
          `read ${path} failed: ${(err as Error).message}`,
        )
      }
    }
    const next = existing + JSON.stringify(validated.data) + '\n'
    writeAtomic(path, next)

    this.onWrite(path, validated.data)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 读文件内容,失败返空字符串(被 append 场景容忍 —— 损坏文件 = 重新起一行) */
function readFileOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** atomic 写文件(tmp + rename) —— 沿用 ChatSessionService writeAtomic 模式 */
function writeAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`
  // 文件权限收紧(macOS 上 mode 仅在文件创建时生效;rename 后权限继承 tmp)
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, target)
}

// ---------------------------------------------------------------------------
// 30 天 sweep(ADR-0029 D16)
// ---------------------------------------------------------------------------

/**
 * 30 天 sweep —— 扫描 `<workspaceRoot>/audit/<reqId>/`,删除超过
 * `ttlDays` 天的 `chat.log`。
 *
 * - 调用方控制时机(跟 SDK session sweep 同步触发)
 * - `nowMs / ttlDays` 测试可注入
 * - 一个 cardId 一个 chat.log,整体文件粒度删除(mtime 判定)
 * - 目录不存在 → 返 0(不抛错)
 *
 * 注:本函数删文件而非清空内容 —— audit log 是 append-only 历史,不再
 * 使用的 card 整机过期清理(`rm chat.log`);路径目录保留(cardId 目录
 * 由 process 重启可能被 recreate,清理层级留 stage 后期)。
 *
 * @returns sweep 计数(被删 chat.log 数)
 */
export function sweepExpiredAuditLogs(
  workspaceRoot: string,
  requirementId: string,
  options?: { nowMs?: number; ttlDays?: number },
): number {
  const ttlDays = options?.ttlDays ?? 30
  const nowMs = options?.nowMs ?? Date.now()
  const reqAuditDir = join(workspaceRoot, 'audit', requirementId)
  if (!existsSync(reqAuditDir)) return 0
  let names: string[]
  try {
    names = readdirSync(reqAuditDir)
  } catch {
    return 0
  }
  let swept = 0
  for (const cardId of names) {
    // 只扫目录(每张 TaskCard 一个独立 audit/<cardId>/)
    const cardDir = join(reqAuditDir, cardId)
    try {
      if (!statSync(cardDir).isDirectory()) continue
    } catch {
      continue
    }
    const logPath = join(cardDir, 'chat.log')
    if (!existsSync(logPath)) continue
    let mtimeMs: number
    try {
      mtimeMs = statSync(logPath).mtimeMs
    } catch {
      continue
    }
    const ageDays = (nowMs - mtimeMs) / (1000 * 60 * 60 * 24)
    if (ageDays <= ttlDays) continue
    try {
      unlinkSync(logPath)
      swept += 1
    } catch {
      // 单条删失败不影响整体 sweep —— 下次再试
      continue
    }
  }
  return swept
}

/**
 * 顶层 sweep —— 遍历 `<workspaceRoot>/audit/<*>/`,对每个 reqId 调一次
 * `sweepExpiredAuditLogs`。
 *
 * 设计意图:server bootstrap 注册的周期 timer(跟 SDK session sweep 同步
 * 触发)直接调本函数,无需 caller 自循环 `requirements/`。
 *
 * - 顶层目录 `audit/` 不存在 → 返 0
 * - 跳过非 reqId 子目录(目录名需匹配 `requirements/` 子目录形态)
 * - `nowMs / ttlDays` 测试可注入
 *
 * @returns sweep 总计数(全部 req 下被删 chat.log 数)
 */
export function sweepExpiredAuditLogsAll(
  workspaceRoot: string,
  options?: { nowMs?: number; ttlDays?: number },
): number {
  const topAuditDir = join(workspaceRoot, 'audit')
  if (!existsSync(topAuditDir)) return 0
  let names: string[]
  try {
    names = readdirSync(topAuditDir)
  } catch {
    return 0
  }
  let total = 0
  for (const requirementId of names) {
    // 顶层下仅扫目录形态的 reqId 容器
    const reqDir = join(topAuditDir, requirementId)
    try {
      if (!statSync(reqDir).isDirectory()) continue
    } catch {
      continue
    }
    total += sweepExpiredAuditLogs(workspaceRoot, requirementId, options)
  }
  return total
}
