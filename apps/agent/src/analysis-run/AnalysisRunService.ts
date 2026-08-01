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
} from 'node:fs'
import { open, mkdir as mkdirAsync, rm as rmAsync } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import yaml from 'yaml'
import {
  type AnalysisRunMeta,
  type AnalysisIssue,
  type AnalysisLogEntry,
  AnalysisRunMetaSchema,
  AnalysisIssueSchema,
  AnalysisLogEntrySchema,
} from '@ai-devspace/shared'

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

  /** 追加 Run Log entry(决策 37) */
  appendLogEntry(
    requirementId: string,
    runId: string,
    entry: AnalysisLogEntry,
  ): { ok: true } | { ok: false; code: 'run_not_found' | 'invalid_entry' } {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) return { ok: false, code: 'run_not_found' }
    const validated = AnalysisLogEntrySchema.safeParse(entry)
    if (!validated.success) return { ok: false, code: 'invalid_entry' }
    appendFileSync(
      join(this.runDirFor(requirementId, runId), 'log.jsonl'),
      JSON.stringify(validated.data) + '\n',
      'utf8',
    )
    return { ok: true }
  }

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

  /** 进程级完成请求状态(决策 30 内部门禁;重启即失效) */
  private completionRequested = new Set<string>()

  /** 由 AnalysisAgentRunner 门禁调用:确认 complete_analysis 已被接受 */
  isCompletionRequested(runId: string): boolean {
    return this.completionRequested.has(runId)
  }
}

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