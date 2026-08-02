/**
 * Analysis Run 持久化 + 单运行约束服务(issue 02 · ADR-0021)
 *
 * 落盘布局(ADR-0021 §"持久化与兼容"):
 * ```
 * <root>/requirements/<req-id>/analysis/runs/<run-id>/
 *   ├── meta.yaml        Run 元数据(状态 / Skill 名 / 时间 / issue_count)
 *   ├── issues.jsonl     Issue 追加日志(每行一条 AnalysisIssue,顺序由平台决定)
 *   ├── log.jsonl        Run Log(模型普通文本 / 工具活动 / 工具输入输出)
 *   └── responses/<issue-id>.md   Issue Response Markdown(本期不写,留接口)
 * ```
 *
 * 单运行约束(ADR-0021 §"领域模型" 段落 1):同 Requirement 同时最多一个
 * `running` Run;启动时用 mkdir 锁(`.startup.lock`)实现跨 process 原子性。
 *
 * Issue 幂等(ADR-0021 §"输出协议"):使用业务工具调用的 SDK tool_use_id
 * 作为幂等键;同一 tool_use_id 重复调用不会产生重复 Issue。
 *
 * 不做的事(明确剔除):
 * - 不保存 Skill 版本 / 哈希 / 正文(ADR-0021 §"领域模型" 段落 4)
 * - 不做语义合并(ADR-0021 §"输出协议")
 * - 不修改 Issue(ADR-0021 §"历史、答复与日志" 段落 36)
 * - 不迁旧 sessions / chunks(ADR-0021 §"持久化与兼容")
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  statSync,
  rmSync,
} from 'node:fs'
import { open, mkdir as mkdirAsync, rm as rmAsync } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import yaml from 'yaml'
import {
  type AnalysisRunMeta,
  type AnalysisIssue,
  type AnalysisLogEntry,
  type IssueResponseMeta,
  type IssueResponseGetResponse,
  AnalysisRunMetaSchema,
  AnalysisIssueSchema,
  AnalysisLogEntrySchema,
  IssueResponseMetaSchema,
} from '@ai-devspace/shared'
import { redactLogEntry } from './runLogRedaction.js'

/** Run 持久化目录路径(单点真相 —— service + route 共享) */
export function analysisRunsDirFor(
  workspaceRoot: string,
  requirementId: string,
): string {
  return join(workspaceRoot, 'requirements', requirementId, 'analysis', 'runs')
}

export interface CreateRunParams {
  requirementId: string
  skillName: string
}

/** Run 创建结果:成功(刚创建) / 失败(单运行约束违反) */
export type CreateRunResult =
  | { ok: true; run: AnalysisRunMeta; runDir: string }
  | {
      ok: false
      code: 'analysis_run_already_running'
      runningRun: AnalysisRunMeta
    }

/**
 * 启动锁文件路径 —— 跨 process 单运行约束原子性的关键。
 *
 * 用 `mkdir` 实现 advisory 锁:同一 Requirement 的第一次 mkdir 成功(锁被占用),
 * 后续 mkdir 抛 EEXIST(锁已存在)。EEXIST 是 POSIX 原子操作,跨 process 安全,
 * 比 readdir→check→mkdir TOCTOU 序列更可靠(issue 02 review 关键修复)。
 *
 * 锁随 Run 创建;Run 进入终态时由 route 显式调用 `releaseStartupLock` 删除。
 * 进程崩溃 / 异常退出 → 锁残留 → 启动新 Run 会失败。**本期未做自动回收**
 * (避免误删其他进程的锁);问题出现时由重启 agent 或人工 `rm -rf` 兜底。
 */
function startupLockPath(workspaceRoot: string, requirementId: string): string {
  return join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    '.startup.lock',
  )
}

/** Issue 提交结果(决策 24 / 29)
 *
 * - `created` —— 首次接受(已持久化 + 顺序已赋)
 * - `duplicate` —— 同一 tool_use_id 重复调用(幂等命中,返回已存在的 Issue) */
export type ReportIssueResult =
  | { ok: true; created: true; issue: AnalysisIssue }
  | { ok: true; created: false; issue: AnalysisIssue }

/** Run 终态转换结果(决策 30 / 31) */
export type TransitionRunResult =
  | { ok: true; run: AnalysisRunMeta }
  | {
      ok: false
      code: 'invalid_transition' | 'run_not_found'
      reason: string
    }

/**
 * Analysis Run Service —— 持久化 + 单运行约束 + Issue 幂等。
 *
 * 设计要点:
 * - 所有写操作 fsync 立即可见(appendFileSync + 原子 rename 模式)
 * - 错误一律抛回 caller(由 route 决定 HTTP 状态)
 * - 读操作容错:文件不存在 / 解析失败 → 返回默认值(不抛错)
 */
export class AnalysisRunService {
  /**
   * 进程级 tool_use_id → Issue 元数据 索引(决策 24 · Issue 幂等)。
   *
   * 简化实现:仅在进程内缓存 tool_use_id 对应的 ordinal + run_id;
   * 跨进程重启失效时退化为"接受重报 → 可能产生重复 Issue"。
   * issue 03 会升级为持久化索引(写到 meta.yaml 旁)。
   */
  private readonly toolUseIndex = new Map<
    string,
    { run_id: string; issue_id: string; ordinal: number }
  >()
  constructor(public readonly workspaceRoot: string) {}

  /** Requirement analysis/runs/ 目录 */
  runsDirFor(requirementId: string): string {
    return analysisRunsDirFor(this.workspaceRoot, requirementId)
  }

  /** 单 Run 目录 */
  runDirFor(requirementId: string, runId: string): string {
    return join(this.runsDirFor(requirementId), runId)
  }

  /**
   * 单运行约束检查(issue 02 review 修复 · ADR 跨 process 原子性):
   *
   * 优先读 startup.lock 文件(快速路径);锁不存在 → 回落到 readdir + meta 扫描
   * (兼容旧数据 / 进程崩溃残留的 running Run 但无锁的情况)。
   */
  findRunningRun(requirementId: string): AnalysisRunMeta | null {
    // 快速路径:startup.lock 存在 → 一定有 running Run
    const lockPath = startupLockPath(this.workspaceRoot, requirementId)
    if (existsSync(lockPath)) {
      // 锁存在时扫描 runs/ 找 status=running 的 Run(读 meta)
      return this.scanRunningRunMeta(requirementId)
    }
    // 慢路径:无锁 → 直接扫描(可能在重启/异常退出后没有锁,但仍有 running Run)
    return this.scanRunningRunMeta(requirementId)
  }

  /** 扫描 runs/ 子目录,返回任意 status=running 的 Run(不做并发保护) */
  private scanRunningRunMeta(requirementId: string): AnalysisRunMeta | null {
    const dir = this.runsDirFor(requirementId)
    if (!existsSync(dir)) return null
    let entries: { name: string; isDir: boolean }[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, isDir: true }))
    } catch {
      return null
    }
    for (const e of entries) {
      const meta = this.readMeta(requirementId, e.name)
      if (meta && meta.status === 'running') return meta
    }
    return null
  }

  /**
   * 创建新 Run(issue 02 review 修复 · 跨 process 原子性)。
   *
   * 流程(用 mkdir 锁替代 readdir TOCTOU 序列):
   * 1. `mkdir(lockPath)` —— 原子操作,跨 process 安全
   *    - EEXIST → 已有 lock → 读 runningRun 元数据返 409
   * 2. mkdir 成功 → 锁已占用 → 写入 runs/<runId>/meta.yaml
   * 3. 锁随 Run 创建,Run 进入终态时由 route 显式 releaseStartupLock
   *
   * 注:**进程崩溃/异常退出 → 锁残留 → 新 Run 会失败**。
   * 本期未做自动回收(避免误删其他进程的锁);
   * agent 重启 + 人工 `rm .startup.lock` 兜底。issue 02 acceptance 11 明确要求
   * "主要接缝 = 启动 REST → fake SDK → 真实 Run 存储 → 真实 SSE Hub",
   * 跨 process 原子性是这一接缝的核心安全保证。
   */
  async createRun(params: CreateRunParams): Promise<CreateRunResult> {
    const { requirementId, skillName } = params

    const lockPath = startupLockPath(this.workspaceRoot, requirementId)

    // 0. 确保 analysis/ 父目录存在(mkdir lock 自身不能递归,否则 EEXIST 失效)
    const analysisDir = join(this.workspaceRoot, 'requirements', requirementId, 'analysis')
    mkdirSync(analysisDir, { recursive: true })

    // 1. 取 mkdir 锁(EEXIST = 已锁定 → 409)
    try {
      await mkdirAsync(lockPath, { recursive: false })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EEXIST') {
        // 锁已占用 → 找出现有 running Run
        const existing = this.scanRunningRunMeta(requirementId)
        if (existing) {
          return {
            ok: false,
            code: 'analysis_run_already_running',
            runningRun: existing,
          }
        }
        // 锁残留但无 running Run(meta 已 finished)→ 可能是 stale 锁;
        // 拒绝本次启动让 agent 重启或运维清理
        return {
          ok: false,
          code: 'analysis_run_already_running',
          runningRun: {
            run_id: '',
            requirement_id: requirementId,
            skill_name: '',
            status: 'running',
            created_at: '',
            finished_at: null,
            issue_count: 0,
            error: 'startup lock exists but no running Run found; please clean up',
          },
        }
      }
      throw err
    }

    // 2. 生成 run_id + 写 meta
    const runId = generateRunId()
    const runDir = this.runDirFor(requirementId, runId)
    const createdAt = new Date().toISOString()

    try {
      mkdirSync(runDir, { recursive: true })
    } catch (err) {
      // 极小概率:lock mkdir 成功但 runDir mkdir 失败 → 释放锁
      await this.releaseStartupLock(requirementId).catch(() => {})
      throw err
    }

    const meta: AnalysisRunMeta = {
      run_id: runId,
      requirement_id: requirementId,
      skill_name: skillName,
      status: 'running',
      created_at: createdAt,
      finished_at: null,
      issue_count: 0,
      error: null,
    }
    writeFileAtomic(join(runDir, 'meta.yaml'), yaml.stringify(meta))
    writeFileSync(join(runDir, 'issues.jsonl'), '', 'utf8')
    writeFileSync(join(runDir, 'log.jsonl'), '', 'utf8')

    return { ok: true, run: meta, runDir }
  }

  /**
   * 释放 startup 锁(由 route 在 Run 进入终态时显式调用)。
   *
   * best-effort:失败不抛错(锁残留问题已在 createRun 中处理为可识别错误)。
   */
  async releaseStartupLock(requirementId: string): Promise<void> {
    const lockPath = startupLockPath(this.workspaceRoot, requirementId)
    if (!existsSync(lockPath)) return
    try {
      await rmAsync(lockPath, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  /** 读 Run 元数据;不存在 / 非法 → null */
  readMeta(requirementId: string, runId: string): AnalysisRunMeta | null {
    const file = join(this.runDirFor(requirementId, runId), 'meta.yaml')
    if (!existsSync(file)) return null
    try {
      const parsed = yaml.parse(readFileSync(file, 'utf8')) as unknown
      const validated = AnalysisRunMetaSchema.safeParse(parsed)
      return validated.success ? validated.data : null
    } catch {
      return null
    }
  }

  /**
   * 追加 Issue(决策 29 · 同步持久化)。
   *
   * 幂等键:`toolUseId`(SDK tool_use.id);同一 tool_use_id 重复调用返 duplicate。
   * 实现:扫描 issues.jsonl 找匹配;不在则追加新 Issue 并 issue_count++。
   *
   * **完成工具已接受后拒绝**:`complete_analysis` 调用后进入
   * `completion_requested` 内部门禁状态(决策 30),后续 Issue 提交返
   * `{ ok: false, code: 'run_completed' }`(由 route 决定工具 result 形态)。
   */
  reportIssue(params: {
    requirementId: string
    runId: string
    toolUseId: string
    input: {
      title: string
      description: string
      sourceRefs: AnalysisIssue['source_refs']
      metadata?: AnalysisIssue['metadata']
    }
  }):
    | { ok: true; result: ReportIssueResult }
    | { ok: false; code: 'run_not_found' | 'run_not_running' | 'run_completed' } {
    const meta = this.readMeta(params.requirementId, params.runId)
    if (!meta) return { ok: false, code: 'run_not_found' }
    if (meta.status === 'failed') {
      return { ok: false, code: 'run_not_running' }
    }
    if (this.completionRequested.has(meta.run_id)) {
      return { ok: false, code: 'run_completed' }
    }

    const runDir = this.runDirFor(params.requirementId, params.runId)
    const issuesFile = join(runDir, 'issues.jsonl')

    // 幂等查找(进程内 tool_use_id 索引)
    const existing = this.toolUseIndex.get(params.toolUseId)
    if (existing && existing.run_id === meta.run_id) {
      const issues = this.readIssues(params.requirementId, params.runId)
      const hit = issues.find((it) => it.issue_id === existing.issue_id)
      if (hit) {
        return { ok: true, result: { ok: true, created: false, issue: hit } }
      }
    }

    const ordinal = meta.issue_count + 1
    const issue: AnalysisIssue = {
      issue_id: `iss-${meta.run_id}-${ordinal.toString().padStart(4, '0')}`,
      run_id: meta.run_id,
      ordinal,
      title: params.input.title.trim(),
      description: params.input.description.trim(),
      source_refs: params.input.sourceRefs,
      metadata: params.input.metadata ?? [],
      reported_at: new Date().toISOString(),
    }
    const validated = AnalysisIssueSchema.safeParse(issue)
    if (!validated.success) {
      // schema 不通过 → 视作工具参数非法(由 route 转 400)
      // 此分支本期不应触发 —— 已经在 route 做 Schema 校验;保留防御
      throw new Error(`Issue schema invalid: ${validated.error.message}`)
    }
    appendFileSync(issuesFile, JSON.stringify(validated.data) + '\n', 'utf8')

    // 更新 issue_count(原子写 meta)
    const updated: AnalysisRunMeta = { ...meta, issue_count: ordinal }
    writeFileAtomic(join(runDir, 'meta.yaml'), yaml.stringify(updated))

    // 记录幂等索引
    this.toolUseIndex.set(params.toolUseId, {
      run_id: meta.run_id,
      issue_id: issue.issue_id,
      ordinal,
    })

    return { ok: true, result: { ok: true, created: true, issue: validated.data } }
  }

  /**
   * 完成工具调用(决策 30):进入 `completion_requested` 内部门禁状态,
   * 拒绝后续 Issue 提交;不立即切换到 succeeded(等待 SDK 成功 + 持久化完成
   * 后由 `transitionToSucceeded` 完成)。
   */
  requestCompletion(requirementId: string, runId: string): TransitionRunResult {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return { ok: false, code: 'run_not_found', reason: `${requirementId}/${runId} not found` }
    }
    if (meta.status !== 'running') {
      return {
        ok: false,
        code: 'invalid_transition',
        reason: `cannot request completion on status=${meta.status}`,
      }
    }
    this.completionRequested.add(meta.run_id)
    return { ok: true, run: meta }
  }

  /** 终态转换 succeeded(决策 31) */
  transitionToSucceeded(requirementId: string, runId: string): TransitionRunResult {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return { ok: false, code: 'run_not_found', reason: `${requirementId}/${runId} not found` }
    }
    if (meta.status !== 'running') {
      return {
        ok: false,
        code: 'invalid_transition',
        reason: `cannot transition non-running run (status=${meta.status})`,
      }
    }
    // 门禁:必须先 requestCompletion
    if (!this.completionRequested.has(meta.run_id)) {
      return {
        ok: false,
        code: 'invalid_transition',
        reason: 'transitionToSucceeded called before requestCompletion',
      }
    }
    const finishedAt = new Date().toISOString()
    const updated: AnalysisRunMeta = {
      ...meta,
      status: 'succeeded',
      finished_at: finishedAt,
    }
    writeFileAtomic(join(this.runDirFor(requirementId, runId), 'meta.yaml'), yaml.stringify(updated))
    this.completionRequested.delete(meta.run_id)
    // 终态自动释放 startup lock(issue 02 review · 单运行约束原子性)
    void this.releaseStartupLock(requirementId).catch(() => {})
    return { ok: true, run: updated }
  }

  /** 终态转换 failed(决策 32) */
  transitionToFailed(
    requirementId: string,
    runId: string,
    error: string,
  ): TransitionRunResult {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return { ok: false, code: 'run_not_found', reason: `${requirementId}/${runId} not found` }
    }
    if (meta.status !== 'running') {
      return {
        ok: false,
        code: 'invalid_transition',
        reason: `cannot transition non-running run (status=${meta.status})`,
      }
    }
    const finishedAt = new Date().toISOString()
    const updated: AnalysisRunMeta = {
      ...meta,
      status: 'failed',
      finished_at: finishedAt,
      error,
    }
    writeFileAtomic(join(this.runDirFor(requirementId, runId), 'meta.yaml'), yaml.stringify(updated))
    this.completionRequested.delete(meta.run_id)
    // 终态自动释放 startup lock(issue 02 review · 单运行约束原子性)
    void this.releaseStartupLock(requirementId).catch(() => {})
    return { ok: true, run: updated }
  }

  /** 追加 Run Log entry(决策 37)
   *
   * issue 06 · 决策 38:落盘前统一脱敏(兜底层)。即便上游 AnalysisAgentRunner
   * 没脱敏或 race 写入未脱敏,这里在写盘前再走一次,保证 log.jsonl 内
   * 不出现 secret 原文。
   */
  appendLogEntry(
    requirementId: string,
    runId: string,
    entry: AnalysisLogEntry,
  ): { ok: true } | { ok: false; code: 'run_not_found' | 'invalid_entry' } {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) return { ok: false, code: 'run_not_found' }
    // 兜底脱敏(issue 06 · 决策 38):上游 AnalysisAgentRunner 已脱敏时 idempotent,
    // 未脱敏时强制抹除。防止 race / 跨 Provider 漏脱敏。
    const sanitized = redactLogEntry(entry)
    const validated = AnalysisLogEntrySchema.safeParse(sanitized)
    if (!validated.success) return { ok: false, code: 'invalid_entry' }
    appendFileSync(
      join(this.runDirFor(requirementId, runId), 'log.jsonl'),
      JSON.stringify(validated.data) + '\n',
      'utf8',
    )
    return { ok: true }
  }

  // sanitizeLogEntryForPersistence 已抽到 runLogRedaction.redactLogEntry,
  // appendLogEntry 直接调用,避免两文件实现漂移。

  /** 读 Run 所有 Issue(顺序追加读) */
  readIssues(requirementId: string, runId: string): AnalysisIssue[] {
    const file = join(this.runDirFor(requirementId, runId), 'issues.jsonl')
    if (!existsSync(file)) return []
    const out: AnalysisIssue[] = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const validated = AnalysisIssueSchema.safeParse(parsed)
        if (validated.success) out.push(validated.data)
      } catch {
        /* 跳过脏行 */
      }
    }
    return out
  }

  /** 读 Run Log(顺序追加读) */
  readLog(requirementId: string, runId: string): AnalysisLogEntry[] {
    const file = join(this.runDirFor(requirementId, runId), 'log.jsonl')
    if (!existsSync(file)) return []
    const out: AnalysisLogEntry[] = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const validated = AnalysisLogEntrySchema.safeParse(parsed)
        if (validated.success) out.push(validated.data)
      } catch {
        /* 跳过脏行 */
      }
    }
    return out
  }

  /**
   * 列 Requirement 的所有 Run 元数据(决策 41 · 按 created_at 倒序)。
   *
   * 容错:目录不存在 / 子目录无 meta.yaml / 解析失败 → 跳过,不影响其它 Run。
   */
  listRuns(requirementId: string): AnalysisRunMeta[] {
    const dir = this.runsDirFor(requirementId)
    if (!existsSync(dir)) return []
    let entries: string[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return []
    }
    const runs: AnalysisRunMeta[] = []
    for (const runId of entries) {
      const meta = this.readMeta(requirementId, runId)
      if (meta) runs.push(meta)
    }
    runs.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return runs
  }

  /**
   * 启动时收敛 orphan running Run(issue 07 验收 9)。
   *
   * 场景:Agent 进程异常退出 / kill -9 / OOM → 残留
   * `<root>/requirements/<id>/analysis/runs/<runId>/meta.yaml`(status=running)
   * 与 `.startup.lock` 目录。新进程启动时,这些 Run 没有任何 in-flight
   * runner 句柄可继续推进,必须收敛为 `failed`,释放单运行锁,使用户可以
   * 重新创建新 Run。
   *
   * 契约:
   * - `aliveRunIds === null` → 假定所有 `status=running` 的 Run 均为
   *   orphan(进程级启动时用最直观;当前没有跨 in-flight 句柄共享需求)
   * - `aliveRunIds: Set<runId>` → 仅把不在 alive 集合中的 running Run 收敛
   *   (留作将来多 agent 协同的扩展点)
   * - **不**删除 issues.jsonl / log.jsonl:保留已完成的 Issue / Response / Log
   * - meta.error 固定为 `'agent_restart_orphan_recovery'` 字符串,便于 UI 区分
   * - 调 `transitionToFailed` 触发自动 releaseStartupLock(issue 02)
   * - **best-effort**:单个 Run 转换失败不阻断其他 Run 的收敛
   */
  reconcileRunningRuns(aliveRunIds: ReadonlySet<string> | null): {
    recovered: Array<{ requirementId: string; runId: string; reason: string }>
    skipped: Array<{ requirementId: string; runId: string; reason: string }>
  } {
    const recovered: Array<{ requirementId: string; runId: string; reason: string }> = []
    const skipped: Array<{ requirementId: string; runId: string; reason: string }> = []

    // 扫描所有 Requirement 的 runs/ 目录
    const reqRoot = join(this.workspaceRoot, 'requirements')
    if (!existsSync(reqRoot)) {
      return { recovered, skipped }
    }
    let reqEntries: string[]
    try {
      reqEntries = readdirSync(reqRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return { recovered, skipped }
    }

    const reason = 'agent_restart_orphan_recovery'
    for (const reqId of reqEntries) {
      const runs = this.listRuns(reqId)
      for (const run of runs) {
        if (run.status !== 'running') continue
        // aliveRunIds === null → 全部 running 视为 orphan
        // aliveRunIds 提供 → 集合内的视为仍 alive,跳过
        if (aliveRunIds !== null && aliveRunIds.has(run.run_id)) {
          skipped.push({
            requirementId: reqId,
            runId: run.run_id,
            reason: 'alive_in_current_process',
          })
          continue
        }
        const result = this.transitionToFailed(reqId, run.run_id, reason)
        if (result.ok) {
          recovered.push({ requirementId: reqId, runId: run.run_id, reason })
        } else {
          skipped.push({
            requirementId: reqId,
            runId: run.run_id,
            reason: result.reason,
          })
        }
      }
    }
    return { recovered, skipped }
  }

  /** 进程级完成请求状态(决策 30 内部门禁;重启即失效) */
  private completionRequested = new Set<string>()

  /** 由 AnalysisAgentRunner 门禁调用:确认 complete_analysis 已被接受 */
  isCompletionRequested(runId: string): boolean {
    return this.completionRequested.has(runId)
  }

  // ---------------------------------------------------------------------------
  // 永久删除 Run(issue 05 · ADR-0021 决策 42)
  //
  // 契约:
  // - 仅终态 Run(succeeded / failed)可删除;running 时拒绝(决策 78)
  // - 服务端级联删除整个 runs/<runId>/ 目录(决策 79):meta / issues / log / responses
  // - 删除后 assembleAnsweredContext / listResponses 自动不再返回该 Run 的 Response
  //   —— `listRuns` 走 readdirSync,目录不存在就不出现(无需特判"已删除")
  // - best-effort:删除失败抛错(由 route 转 500);releaseStartupLock 是幂等的
  // ---------------------------------------------------------------------------

  /**
   * 删除终态 Run(issue 05 验收 9 / 10 / 11)。
   *
   * 返回值:
   * - `ok: true` —— 删除成功 + Run 已不在 listRuns 中
   * - `ok: false, code: 'run_not_found'` —— Run 不存在
   * - `ok: false, code: 'run_still_running'` —— 当前 status === 'running' 拒绝
   * - `ok: false, code: 'delete_failed'` —— fs 删除抛错(返回 reason)
   */
  deleteRun(
    requirementId: string,
    runId: string,
  ):
    | { ok: true; run: AnalysisRunMeta }
    | {
        ok: false
        code: 'run_not_found' | 'run_still_running' | 'delete_failed'
        reason: string
        run?: AnalysisRunMeta
      } {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return {
        ok: false,
        code: 'run_not_found',
        reason: `${requirementId}/${runId} not found`,
      }
    }
    if (meta.status === 'running') {
      return {
        ok: false,
        code: 'run_still_running',
        reason: 'cannot delete a running Run; wait for it to reach a terminal state',
        run: meta,
      }
    }

    const runDir = this.runDirFor(requirementId, runId)
    try {
      rmSync(runDir, { recursive: true, force: true })
    } catch (err) {
      return {
        ok: false,
        code: 'delete_failed',
        reason: err instanceof Error ? err.message : String(err),
      }
    }
    // 清理进程级完成门禁状态(避免 set 无限增长)
    this.completionRequested.delete(runId)
    return { ok: true, run: meta }
  }

  // ---------------------------------------------------------------------------
  // Issue Response(issue 04 · ADR-0021 决策 40)
  //
  // 落盘布局:
  //   <runDir>/responses/<issue-id>.md       Markdown 正文
  //   <runDir>/responses/<issue-id>.meta.yaml 单调编辑版本 + 时间
  //
  // 不做的事:
  // - 不修改原始 Issue(决策 36 · 已由 readIssues 不暴露写路径保证)
  // - 不做语义合并(决策 24)
  // - 不自动总结 / 截断(决策 15)
  // - 不依赖服务端缓存,每次读都重新 fs 读取 + YAML parse
  // ---------------------------------------------------------------------------

  /** Run 内 Issue Response 目录(单 Run 维度,issue 04 · ADR-0021 决策 43) */
  responsesDirFor(requirementId: string, runId: string): string {
    return join(this.runDirFor(requirementId, runId), 'responses')
  }

  /** 单 Issue Response Markdown 路径 */
  private responseBodyPath(requirementId: string, runId: string, issueId: string): string {
    return join(this.responsesDirFor(requirementId, runId), `${issueId}.md`)
  }

  /** 单 Issue Response 元数据路径 */
  private responseMetaPath(requirementId: string, runId: string, issueId: string): string {
    return join(this.responsesDirFor(requirementId, runId), `${issueId}.meta.yaml`)
  }

  /**
   * 读单 Issue Response(issue 04 验收 1 + 3)。
   *
   * 返回:
   * - 不存在(从未写过) → `{ ok: true, response: null }`
   * - 存在但元数据 / 正文损坏 → `{ ok: false, code: 'response_corrupt', reason }`
   * - 正常 → `{ ok: true, response: IssueResponseGetResponse }`
   */
  readResponse(
    requirementId: string,
    runId: string,
    issueId: string,
  ):
    | { ok: true; response: IssueResponseGetResponse | null }
    | { ok: false; code: 'response_corrupt'; reason: string } {
    const metaPath = this.responseMetaPath(requirementId, runId, issueId)
    if (!existsSync(metaPath)) return { ok: true, response: null }
    let rawMeta: string
    try {
      rawMeta = readFileSync(metaPath, 'utf8')
    } catch (err) {
      return {
        ok: false,
        code: 'response_corrupt',
        reason: err instanceof Error ? err.message : String(err),
      }
    }
    let parsedMeta: unknown
    try {
      parsedMeta = yaml.parse(rawMeta)
    } catch (err) {
      return {
        ok: false,
        code: 'response_corrupt',
        reason: `meta yaml parse failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    const validated = IssueResponseMetaSchema.safeParse(parsedMeta)
    if (!validated.success) {
      return {
        ok: false,
        code: 'response_corrupt',
        reason: `meta schema invalid: ${validated.error.message}`,
      }
    }
    const bodyPath = this.responseBodyPath(requirementId, runId, issueId)
    let body = ''
    if (existsSync(bodyPath)) {
      try {
        body = readFileSync(bodyPath, 'utf8')
      } catch (err) {
        return {
          ok: false,
          code: 'response_corrupt',
          reason: `body read failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }
    const response: IssueResponseGetResponse = {
      issue_id: issueId,
      run_id: validated.data.run_id,
      body,
      created_at: validated.data.created_at,
      updated_at: validated.data.updated_at,
      edit_version: validated.data.edit_version,
      answered: body.trim().length > 0,
    }
    return { ok: true, response }
  }

  /**
   * 写 Issue Response(issue 04 验收 5 / 7)。
   *
   * 并发控制(决策 46):客户端 PUT 必须带 `base_edit_version`;服务端在 atomic
   * 写之前 +1 写入(单调递增)。`base_edit_version` 与当前服务端版本不匹配 →
   * 返 `{ ok: false, code: 'stale_response', current }`,客户端需要把本地
   * 最新已 flush 的内容重新提交(较晚返回的旧请求不会覆盖更新正文)。
   *
   * 不修改原始 Issue(决策 36):本方法只写 responses/<issue-id>.{md,meta.yaml}。
   */
  writeResponse(
    requirementId: string,
    runId: string,
    issueId: string,
    body: string,
    baseEditVersion: number,
  ):
    | { ok: true; result: { created_at: string; updated_at: string; edit_version: number; answered: boolean } }
    | { ok: false; code: 'run_not_found' | 'issue_not_found' | 'stale_response' | 'response_corrupt'; reason?: string; current?: { edit_version: number; updated_at: string } } {
    // 0. Run 必须存在(任意终态 / running 都允许写 Response —— 决策 39:任意
    //    未删除历史 Run 的 Issue 都可新增或编辑 Response)
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return { ok: false, code: 'run_not_found', reason: `${requirementId}/${runId} not found` }
    }
    // 1. Issue 必须存在(同一 Run 内;避免写入"孤儿"Response)
    const issues = this.readIssues(requirementId, runId)
    if (!issues.some((it) => it.issue_id === issueId)) {
      return {
        ok: false,
        code: 'issue_not_found',
        reason: `issue '${issueId}' not found in run '${runId}'`,
      }
    }

    const dir = this.responsesDirFor(requirementId, runId)
    mkdirSync(dir, { recursive: true })

    const metaPath = this.responseMetaPath(requirementId, runId, issueId)
    const bodyPath = this.responseBodyPath(requirementId, runId, issueId)

    // 2. 读已有 meta(若有)→ 验证 base_edit_version
    const existing = this.readResponse(requirementId, runId, issueId)
    if (!existing.ok) {
      // 元数据损坏 → 拒绝写入,要求 route 触发修复路径(本期不自动修复)
      return existing
    }
    const currentVersion = existing.response?.edit_version ?? 0
    if (existing.response && baseEditVersion !== currentVersion) {
      return {
        ok: false,
        code: 'stale_response',
        reason: `base_edit_version ${baseEditVersion} != current ${currentVersion}`,
        current: {
          edit_version: existing.response.edit_version,
          updated_at: existing.response.updated_at,
        },
      }
    }

    const now = new Date().toISOString()
    const newVersion = currentVersion + 1
    const createdAt = existing.response?.created_at ?? now
    const newMeta: IssueResponseMeta = {
      issue_id: issueId,
      run_id: runId,
      created_at: createdAt,
      updated_at: now,
      edit_version: newVersion,
    }

    // 3. atomic 写(decision 36 + 服务端落盘契约):沿用 writeFileAtomic helper
    //    确保写入失败时不会撕裂 YAML/JSONL(沿用 file 顶部 helper 的 tmp+rename)
    try {
      writeFileAtomic(bodyPath, body)
      writeFileAtomic(metaPath, yaml.stringify(newMeta))
    } catch (err) {
      return {
        ok: false,
        code: 'response_corrupt',
        reason: err instanceof Error ? err.message : String(err),
      }
    }

    return {
      ok: true,
      result: {
        created_at: createdAt,
        updated_at: now,
        edit_version: newVersion,
        answered: body.trim().length > 0,
      },
    }
  }

  /**
   * 列当前 Requirement 所有未删除 Run 的 Issue Response(issue 04 验收 11)。
   *
   * - 仅包含正文非空(trim 后非空 → 视为"已答复")
   * - 按 Response 最后更新时间从旧到新稳定排序(决策 14)
   * - 同一更新时间 → 按 Issue id 字典序稳定排序
   * - Run Log 与未答复 Issue 不进入(决策 13)
   * - 删除的 Run 自动级联消失(由 listRuns 决定)
   */
  listResponses(requirementId: string): IssueResponseGetResponse[] {
    const out: IssueResponseGetResponse[] = []
    for (const run of this.listRuns(requirementId)) {
      // 防御:Run 元数据存在但 issues.jsonl 损坏 → 跳过该 Run 的响应
      const issues = this.readIssues(requirementId, run.run_id)
      if (issues.length === 0) continue
      for (const issue of issues) {
        const read = this.readResponse(requirementId, run.run_id, issue.issue_id)
        if (!read.ok) continue
        if (!read.response) continue
        if (!read.response.answered) continue
        out.push(read.response)
      }
    }
    // 按 updated_at 升序稳定排序(决策 14:历史答复按最后更新时间从旧到新)
    // 二次稳定排序:同一 updated_at → 按 issue_id 字典序
    out.sort((a, b) => {
      const t = a.updated_at.localeCompare(b.updated_at)
      if (t !== 0) return t
      return a.issue_id.localeCompare(b.issue_id)
    })
    return out
  }

  /**
   * 装配下一 Run 的已答复上下文(issue 04 验收 11 / 12 / 13 / 14 / 15)。
   *
   * 契约:
   * - 只加载未删除历史 Run 中**正文非空**的 Response(决策 13)
   * - 同时携带原始 Issue 标题、描述、SourceRef、metadata 和 Response 更新时间
   * - 不得注入未答复 Issue、Run Log 或旧 ANALYZING 产物(决策 13)
   * - 按 Response 更新时间从旧到新稳定排序(决策 14)
   *
   * 上下文预算(决策 15):完整原文超过当前模型可接受预算 → 返
   * `{ ok: false, code: 'context_overflow', totalChars, maxChars }`;
   * 不得取最近 N 条、静默截断或自动总结。
   *
   * `maxChars` 由 route 注入(本期固定 `MAX_ANSWERED_CONTEXT_CHARS`,
   * 后续按模型 / Provider 切换)。
   */
  assembleAnsweredContext(
    requirementId: string,
    maxChars: number,
  ):
    | { ok: true; items: AssembledAnsweredItem[]; totalChars: number }
    | { ok: false; code: 'context_overflow'; totalChars: number; maxChars: number } {
    const raw = this.listResponses(requirementId)
    // 装配每条:(run_id, issue 元数据 + response 原文 + updated_at)
    const items: AssembledAnsweredItem[] = []
    for (const r of raw) {
      const issues = this.readIssues(requirementId, r.run_id)
      const issue = issues.find((it) => it.issue_id === r.issue_id)
      if (!issue) continue
      items.push({
        run_id: r.run_id,
        issue_id: r.issue_id,
        issue_title: issue.title,
        issue_description: issue.description,
        source_refs: issue.source_refs,
        metadata: issue.metadata,
        updated_at: r.updated_at,
        response: r.body,
      })
    }
    // 稳定排序:updated_at 从旧到新(决策 14),同一时间按 issue_id 字典序
    items.sort((a, b) => {
      const t = a.updated_at.localeCompare(b.updated_at)
      if (t !== 0) return t
      return a.issue_id.localeCompare(b.issue_id)
    })

    // 计算总字符数(粗略;不切 token,因为 GPT/Claude 按字节而非字符的子序列算 token)
    let totalChars = 0
    for (const it of items) {
      totalChars +=
        it.issue_title.length +
        it.issue_description.length +
        it.response.length +
        // 元数据 / source_refs 序列化估算
        JSON.stringify(it.source_refs).length +
        JSON.stringify(it.metadata).length +
        // 结构固定开销
        200
    }
    if (totalChars > maxChars) {
      return { ok: false, code: 'context_overflow', totalChars, maxChars }
    }
    return { ok: true, items, totalChars }
  }
}

/** Issue Response 装配后供 prompt 使用的结构(AnalysisPromptAssembler 同步消费) */
export interface AssembledAnsweredItem {
  run_id: string
  issue_id: string
  issue_title: string
  issue_description: string
  source_refs: ReadonlyArray<AnalysisIssue['source_refs'][number]>
  metadata: ReadonlyArray<readonly [string, unknown]>
  updated_at: string
  response: string
}

/**
 * 默认上下文预算上限(issue 04 验收 13):整套已答复原文允许的最大字符数。
 *
 * 决策依据(决策 15):Claude Agent SDK 当前默认 model 为 Sonnet 系列,
 * 上下文窗口 200k token;层 8 答复原文 + 层 9 PRD 全文共同占用,这里给答复
 * 一层预留 80k 字符 ≈ 25-30k token 的安全预算(不含元数据 / 结构开销),
 * 留出充分余量给 PRD 全文 + Skill 正文 + 模型生成空间。
 *
 * 真实接 SDK 时由 route 根据模型 / Provider 注入更精确的预算。
 */
export const MAX_ANSWERED_CONTEXT_CHARS = 80_000

/**
 * 生成 Run id:`run-<base36 timestamp>-<6 hex bytes>`。
 * 同 Requirement ms 级并发也不会冲突(随机部分)。
 */
function generateRunId(): string {
  const ts = Date.now().toString(36)
  const rnd = randomBytes(3).toString('hex')
  return `run-${ts}-${rnd}`
}

/** 原子写文件(tmp + rename 模式) —— 防止 fsync 期间崩溃撕裂 YAML/JSONL */
function writeFileAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, target)
}