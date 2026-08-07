/**
 * PrdSplitService —— PRD 拆解 Run 持久化 + 单运行约束 + 候选幂等
 *
 * issue 05 / ADR-0027 D4。镜像 `AnalysisRunService`(issue 02 · ADR-0021)
 * 的最小模式,但产物形态不同:
 *
 * 落盘布局(决策 2「目录即真相」+ ADR-0027 D4):
 * ```
 * <root>/requirements/<req-id>/analysis/proposals/<run-id>/
 *   ├── meta.yaml     Run 元数据(running / succeeded / failed)
 *   └── cards.yaml    候选卡片数组(artifact,ProposeCardHandler 累积)
 * ```
 * 与 `analysis/runs/<run-id>/` 平级(不同工作流,物理隔离)。
 *
 * 单运行约束:同 Requirement 同时最多一个 `running` PRD 拆解 Run;
 * 用 mkdir 锁(`.prd-split.lock`,与 analysis 的 `.startup.lock` 区分,
 * 避免互锁)实现跨 process 原子性。
 *
 * 候选幂等:用 SDK tool_use_id 作幂等键;同一 tool_use_id 重复调
 * `appendProposal` 不会产生重复卡片(镜像 `reportIssue` 的 toolUseIndex)。
 *
 * 守门(ADR-0023 zero-touch):本服务**不**调 Provider / Run;
 * Run 触发由 `PrdSplitRunner` 调 `provider.runAnalysisQuery`,本服务只管落盘。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { mkdir as mkdirAsync, rm as rmAsync } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import yaml from 'yaml'
import {
  PRD_SPLIT_CARDS_SCHEMA_VERSION,
  PrdSplitCardsFileSchema,
  PrdSplitProposalSchema,
  PrdSplitRunMetaSchema,
  type PrdSplitCardsFile,
  type PrdSplitGranularityT,
  type PrdSplitProposal,
  type PrdSplitRunMeta,
} from '@ai-devspace/shared'
import {
  generatePrdSplitRunId,
  prdSplitLockPath,
  proposalCardsPathFor,
  proposalDirFor,
  proposalMetaPathFor,
} from './proposalPaths.js'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** PrdSplitService 失败时抛错(本服务只在 IO/状态层抛,业务校验走返值)。 */
export class PrdSplitServiceError extends Error {
  constructor(
    public readonly code:
      | 'E_IO'
      | 'E_INVALID_INPUT',
    message: string,
  ) {
    super(message)
    this.name = 'PrdSplitServiceError'
  }
}

// ---------------------------------------------------------------------------
// 入参 / 返值
// ---------------------------------------------------------------------------

export interface CreatePrdSplitRunParams {
  requirementId: string
  granularity: PrdSplitGranularityT
  expectedCount: number
  useContext: ReadonlyArray<string>
}

export type CreatePrdSplitRunResult =
  | { ok: true; run: PrdSplitRunMeta; runDir: string }
  | {
      ok: false
      code: 'prd_split_already_running'
      runningRun: PrdSplitRunMeta
    }
  | { ok: false; code: 'startup_lock_stale'; reason: string }

export interface AppendProposalParams {
  requirementId: string
  runId: string
  /** SDK tool_use_id(幂等键) */
  toolUseId: string
  /** 模型通过 propose_card 工具传入的 args(已过 wrapper) */
  input: {
    title: string
    content?: string
    suggested_priority?: 'low' | 'medium' | 'high' | 'urgent' | null
    labels?: string[]
  }
}

export type AppendProposalResult =
  | { ok: true; created: boolean; proposal: PrdSplitProposal }
  | {
      ok: false
      code: 'run_not_found' | 'run_not_running' | 'duplicate' | 'invalid_input'
      reason: string
    }

export interface PrdSplitServiceDeps {
  root: string
  /** 测试注入确定性 run id */
  runIdFactory?: () => string
  /** 测试注入固定时间 */
  nowIso?: () => string
}

// ---------------------------------------------------------------------------
// 主类
// ---------------------------------------------------------------------------

export class PrdSplitService {
  private readonly root: string
  private readonly runIdFactory: () => string
  private readonly nowIso: () => string
  /**
   * 进程级 tool_use_id → ordinal 索引(候选幂等)。
   * 镜像 `AnalysisRunService.toolUseIndex`;跨进程重启失效时退化为
   * "读 cards.yaml 比对"(readCards 内做)。Run 终态时清本 Run 条目。
   */
  private readonly toolUseIndex = new Map<
    string,
    { run_id: string; ordinal: number }
  >()

  constructor(deps: PrdSplitServiceDeps) {
    this.root = deps.root
    this.runIdFactory = deps.runIdFactory ?? (() => generatePrdSplitRunId())
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
  }

  // -------------------------------------------------------------------------
  // 创建 Run
  // -------------------------------------------------------------------------

  async createRun(
    params: CreatePrdSplitRunParams,
  ): Promise<CreatePrdSplitRunResult> {
    const { requirementId, granularity, expectedCount, useContext } = params
    const lockPath = prdSplitLockPath(this.root, requirementId)

    // 0. 确保 analysis/ 父目录存在(mkdir lock 不能递归,否则 EEXIST 失效)
    const analysisDir = join(
      this.root,
      'requirements',
      requirementId,
      'analysis',
    )
    mkdirSync(analysisDir, { recursive: true })

    // 1. 取 mkdir 锁(EEXIST = 已锁定)
    try {
      await mkdirAsync(lockPath, { recursive: false })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EEXIST') {
        const existing = this.scanRunningRunMeta(requirementId)
        if (existing) {
          return {
            ok: false,
            code: 'prd_split_already_running',
            runningRun: existing,
          }
        }
        return {
          ok: false,
          code: 'startup_lock_stale',
          reason:
            'prd-split lock exists but no running Run found; reconcile may have missed cleanup, please restart the agent or clean up `.aidevspace/requirements/<id>/analysis/.prd-split.lock`',
        }
      }
      throw err
    }

    // 2. 生成 run_id + 写 meta.yaml + 空 cards.yaml
    const runId = this.runIdFactory()
    const runDir = proposalDirFor(this.root, requirementId, runId)
    const createdAt = this.nowIso()

    try {
      mkdirSync(runDir, { recursive: true })
    } catch (err) {
      await this.releaseLock(requirementId).catch(() => {})
      throw err
    }

    const meta: PrdSplitRunMeta = {
      schema_version: PRD_SPLIT_CARDS_SCHEMA_VERSION,
      run_id: runId,
      requirement_id: requirementId,
      status: 'running',
      created_at: createdAt,
      finished_at: null,
      error: null,
      granularity,
      expected_count: expectedCount,
      actual_count: 0,
    }
    const validatedMeta = PrdSplitRunMetaSchema.safeParse(meta)
    if (!validatedMeta.success) {
      await this.releaseLock(requirementId).catch(() => {})
      throw new PrdSplitServiceError(
        'E_INVALID_INPUT',
        `meta invalid: ${validatedMeta.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    writeFileAtomic(proposalMetaPathFor(this.root, requirementId, runId), yaml.stringify(validatedMeta.data))
    // 空 cards.yaml(候选随 propose_card 累积)
    const emptyCards = {
      schema_version: PRD_SPLIT_CARDS_SCHEMA_VERSION,
      run_id: runId,
      requirement_id: requirementId,
      created_at: createdAt,
      granularity,
      expected_count: expectedCount,
      candidates: [],
    }
    writeFileAtomic(
      proposalCardsPathFor(this.root, requirementId, runId),
      yaml.stringify(emptyCards),
    )

    return { ok: true, run: validatedMeta.data, runDir }
  }

  // -------------------------------------------------------------------------
  // 追加候选卡片(propose_card handler 调)
  // -------------------------------------------------------------------------

  appendProposal(params: AppendProposalParams): AppendProposalResult {
    const { requirementId, runId, toolUseId, input } = params
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return {
        ok: false,
        code: 'run_not_found',
        reason: `run ${runId} not found in req ${requirementId}`,
      }
    }
    if (meta.status !== 'running') {
      return {
        ok: false,
        code: 'run_not_running',
        reason: `run ${runId} status=${meta.status} (not running)`,
      }
    }

    // 幂等:同 toolUseId 已记录 → 返已存 proposal(duplicate)
    const indexed = this.toolUseIndex.get(toolUseId)
    if (indexed && indexed.run_id === runId) {
      const cards = this.readCards(requirementId, runId)
      const existing = cards.find((c) => c.tool_use_id === toolUseId)
      if (existing) {
        return { ok: true, created: false, proposal: existing }
      }
      // 索引命中但磁盘无记录(跨重启)→ 视为新,继续写
    }

    // 读现有 cards → 派生 ordinal → 构造完整 proposal → 校验 → atomic 重写
    // 注:ordinal 是 handler 派生字段(min(1)),必须在算出后才能过 schema。
    const cards = this.readCards(requirementId, runId)
    const ordinal = cards.length + 1
    const proposalDraft: PrdSplitProposal = {
      ordinal,
      tool_use_id: toolUseId,
      title: input.title,
      content: input.content ?? '',
      suggested_status: 'backlog',
      suggested_priority: input.suggested_priority ?? null,
      labels: input.labels ?? [],
    }
    const parsed = PrdSplitProposalSchema.safeParse(proposalDraft)
    if (!parsed.success) {
      return {
        ok: false,
        code: 'invalid_input',
        reason: parsed.error.issues.map((i) => i.message).join('; '),
      }
    }
    const proposal = parsed.data
    cards.push(proposal)

    // 读 cards.yaml 顶层 + 更新 candidates + actual_count + atomic 写
    const cardsFile = this.readCardsFile(requirementId, runId)
    if (!cardsFile) {
      return {
        ok: false,
        code: 'run_not_found',
        reason: `cards.yaml missing for run ${runId}`,
      }
    }
    const nextFile = {
      ...cardsFile,
      candidates: cards,
    }
    const validatedFile = PrdSplitCardsFileSchema.safeParse(nextFile)
    if (!validatedFile.success) {
      return {
        ok: false,
        code: 'invalid_input',
        reason: validatedFile.error.issues.map((i) => i.message).join('; '),
      }
    }
    try {
      writeFileAtomic(
        proposalCardsPathFor(this.root, requirementId, runId),
        yaml.stringify(validatedFile.data),
      )
    } catch (err) {
      throw new PrdSplitServiceError(
        'E_IO',
        `write cards.yaml failed: ${(err as Error).message}`,
      )
    }

    // 更新 meta.yaml actual_count
    const updatedMeta: PrdSplitRunMeta = {
      ...meta,
      actual_count: cards.length,
    }
    const validatedMeta = PrdSplitRunMetaSchema.safeParse(updatedMeta)
    if (validatedMeta.success) {
      try {
        writeFileAtomic(
          proposalMetaPathFor(this.root, requirementId, runId),
          yaml.stringify(validatedMeta.data),
        )
      } catch {
        /* best-effort:meta 写失败不回滚 cards(已落盘) */
      }
    }

    // 索引(幂等加速)
    this.toolUseIndex.set(toolUseId, { run_id: runId, ordinal })

    return { ok: true, created: true, proposal }
  }

  // -------------------------------------------------------------------------
  // 终态转换
  // -------------------------------------------------------------------------

  transitionToSucceeded(
    requirementId: string,
    runId: string,
  ): { ok: true; run: PrdSplitRunMeta } | { ok: false; reason: string } {
    return this.transitionTo(requirementId, runId, 'succeeded', null)
  }

  transitionToFailed(
    requirementId: string,
    runId: string,
    error: string,
  ): { ok: true; run: PrdSplitRunMeta } | { ok: false; reason: string } {
    return this.transitionTo(requirementId, runId, 'failed', error)
  }

  private transitionTo(
    requirementId: string,
    runId: string,
    status: 'succeeded' | 'failed',
    error: string | null,
  ): { ok: true; run: PrdSplitRunMeta } | { ok: false; reason: string } {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return { ok: false, reason: `run ${runId} not found` }
    }
    if (meta.status !== 'running') {
      return {
        ok: false,
        reason: `run ${runId} status=${meta.status} (cannot transition to ${status})`,
      }
    }
    const cards = this.readCards(requirementId, runId)
    const updated: PrdSplitRunMeta = {
      ...meta,
      status,
      finished_at: this.nowIso(),
      error,
      actual_count: status === 'succeeded' ? cards.length : meta.actual_count,
    }
    const validated = PrdSplitRunMetaSchema.safeParse(updated)
    if (!validated.success) {
      return {
        ok: false,
        reason: `meta invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      }
    }
    try {
      writeFileAtomic(
        proposalMetaPathFor(this.root, requirementId, runId),
        yaml.stringify(validated.data),
      )
    } catch (err) {
      return { ok: false, reason: `write meta failed: ${(err as Error).message}` }
    }
    // 清本 Run 的 toolUseIndex(镜像 clearToolUseIndexForRun)
    this.clearToolUseIndexForRun(runId)
    return { ok: true, run: validated.data }
  }

  // -------------------------------------------------------------------------
  // 锁 / 读 / 列表 / 删除
  // -------------------------------------------------------------------------

  async releaseLock(requirementId: string): Promise<void> {
    const lockPath = prdSplitLockPath(this.root, requirementId)
    if (!existsSync(lockPath)) return
    try {
      await rmAsync(lockPath, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  findRunningRun(requirementId: string): PrdSplitRunMeta | null {
    const lockPath = prdSplitLockPath(this.root, requirementId)
    if (existsSync(lockPath)) {
      return this.scanRunningRunMeta(requirementId)
    }
    return this.scanRunningRunMeta(requirementId)
  }

  private scanRunningRunMeta(requirementId: string): PrdSplitRunMeta | null {
    const parentDir = join(
      this.root,
      'requirements',
      requirementId,
      'analysis',
      'proposals',
    )
    if (!existsSync(parentDir)) return null
    let entries: string[]
    try {
      entries = readdirSync(parentDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return null
    }
    for (const runId of entries) {
      const meta = this.readMeta(requirementId, runId)
      if (meta && meta.status === 'running') return meta
    }
    return null
  }

  readMeta(requirementId: string, runId: string): PrdSplitRunMeta | null {
    const file = proposalMetaPathFor(this.root, requirementId, runId)
    if (!existsSync(file)) return null
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = yaml.parse(raw)
    } catch {
      return null
    }
    const r = PrdSplitRunMetaSchema.safeParse(parsed)
    return r.success ? r.data : null
  }

  /** 读 cards.yaml 的 candidates 数组(容错:缺失/解析失败 → []) */
  readCards(requirementId: string, runId: string): PrdSplitProposal[] {
    const file = this.readCardsFile(requirementId, runId)
    return file ? file.candidates : []
  }

  /** 读完整 cards.yaml 顶层对象(容错:缺失/解析失败 → null) */
  readCardsFile(
    requirementId: string,
    runId: string,
  ): PrdSplitCardsFile | null {
    const file = proposalCardsPathFor(this.root, requirementId, runId)
    if (!existsSync(file)) return null
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = yaml.parse(raw)
    } catch {
      return null
    }
    const r = PrdSplitCardsFileSchema.safeParse(parsed)
    return r.success ? r.data : null
  }

  listRuns(requirementId: string): PrdSplitRunMeta[] {
    const parentDir = join(
      this.root,
      'requirements',
      requirementId,
      'analysis',
      'proposals',
    )
    if (!existsSync(parentDir)) return []
    let entries: string[]
    try {
      entries = readdirSync(parentDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return []
    }
    const runs: PrdSplitRunMeta[] = []
    for (const runId of entries) {
      const meta = this.readMeta(requirementId, runId)
      if (meta) runs.push(meta)
    }
    runs.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return runs
  }

  deleteRun(
    requirementId: string,
    runId: string,
  ):
    | { ok: true; run: PrdSplitRunMeta }
    | { ok: false; code: string; reason: string; run?: PrdSplitRunMeta } {
    const meta = this.readMeta(requirementId, runId)
    if (!meta) {
      return { ok: false, code: 'run_not_found', reason: `run ${runId} not found` }
    }
    if (meta.status === 'running') {
      return {
        ok: false,
        code: 'run_still_running',
        reason: `run ${runId} is still running`,
        run: meta,
      }
    }
    try {
      rmSync(proposalDirFor(this.root, requirementId, runId), {
        recursive: true,
        force: true,
      })
    } catch (err) {
      return {
        ok: false,
        code: 'delete_failed',
        reason: (err as Error).message,
      }
    }
    return { ok: true, run: meta }
  }

  // -------------------------------------------------------------------------
  // boot 时 orphan 收敛(镜像 reconcileRunningRuns)
  // -------------------------------------------------------------------------

  async reconcileOrphanRuns(): Promise<{
    recovered: Array<{ requirementId: string; runId: string }>
    skipped: Array<{ requirementId: string; runId: string }>
  }> {
    const recovered: Array<{ requirementId: string; runId: string }> = []
    const skipped: Array<{ requirementId: string; runId: string }> = []
    const reqsToRelease = new Set<string>()

    const reqRoot = join(this.root, 'requirements')
    if (!existsSync(reqRoot)) return { recovered, skipped }
    let reqEntries: string[]
    try {
      reqEntries = readdirSync(reqRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return { recovered, skipped }
    }

    for (const reqId of reqEntries) {
      const runs = this.listRuns(reqId)
      for (const run of runs) {
        if (run.status !== 'running') continue
        const result = this.transitionToFailed(
          reqId,
          run.run_id,
          'agent_restart_orphan_recovery',
        )
        if (result.ok) {
          recovered.push({ requirementId: reqId, runId: run.run_id })
          reqsToRelease.add(reqId)
        } else {
          skipped.push({ requirementId: reqId, runId: run.run_id })
        }
      }
    }

    // 显式释放锁(PR-A ticket 11 同款:force release 防 microtask race)
    for (const reqId of reqsToRelease) {
      await this.releaseLock(reqId).catch(() => {})
    }
    return { recovered, skipped }
  }

  /** 清本 Run 的 toolUseIndex 条目(镜像 clearToolUseIndexForRun) */
  clearToolUseIndexForRun(runId: string): void {
    for (const [key, val] of this.toolUseIndex.entries()) {
      if (val.run_id === runId) this.toolUseIndex.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// atomic write(沿用 AnalysisRunService / TaskCardTranscript 模式)
// ---------------------------------------------------------------------------

function writeFileAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, target)
}
