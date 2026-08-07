/**
 * PRD 拆解 Run 路径 + run-id helper — issue 05 / ADR-0027 D4
 *
 * 镜像 `analysis-run/AnalysisRunService.ts:56-61`(analysisRunsDirFor)+ `:1085`
 * (generateRunId),但:
 * - 产物落 `analysis/proposals/<run-id>/`(与 `analysis/runs/<run-id>/` 平级,
 *   决策 2「目录即真相」+ ADR-0027 D4)
 * - run-id 前缀 `prd-`(与 analysis `run-` 区分,避免 listRuns 误纳)
 *
 * 物理布局:
 *   <root>/requirements/<req-id>/analysis/proposals/<run-id>/
 *     ├── meta.yaml     Run 状态(running / succeeded / failed)
 *     └── cards.yaml    候选卡片数组(artifact)
 */

import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * `analysis/proposals/` 目录 —— 一个 Requirement 下所有 PRD 拆解 Run 的根。
 * 与 `analysis/runs/` 平级(ADR-0027 D4)。
 */
export function analysisProposalsDirFor(
  workspaceRoot: string,
  requirementId: string,
): string {
  return join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    'proposals',
  )
}

/** 单个 Run 目录:`analysis/proposals/<run-id>/` */
export function proposalDirFor(
  workspaceRoot: string,
  requirementId: string,
  runId: string,
): string {
  return join(analysisProposalsDirFor(workspaceRoot, requirementId), runId)
}

/** `<run-id>/cards.yaml` —— 候选卡片 artifact */
export function proposalCardsPathFor(
  workspaceRoot: string,
  requirementId: string,
  runId: string,
): string {
  return join(proposalDirFor(workspaceRoot, requirementId, runId), 'cards.yaml')
}

/** `<run-id>/meta.yaml` —— Run 状态(running / succeeded / failed) */
export function proposalMetaPathFor(
  workspaceRoot: string,
  requirementId: string,
  runId: string,
): string {
  return join(proposalDirFor(workspaceRoot, requirementId, runId), 'meta.yaml')
}

/**
 * 启动锁路径 —— 跨 process 单 Run 约束(mkdir advisory lock)。
 *
 * 与 analysis Run 的 `.startup.lock` 区分(不同工作流,独立锁,避免互锁)。
 * 镜像 `AnalysisRunService.startupLockPath:99`。
 */
export function prdSplitLockPath(
  workspaceRoot: string,
  requirementId: string,
): string {
  return join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    '.prd-split.lock',
  )
}

/**
 * 生成 PRD 拆解 Run id:`prd-<base36 timestamp>-<6 hex>`。
 *
 * 镜像 `AnalysisRunService.generateRunId:1085`(前缀改 `prd-`);同 Requirement
 * ms 级并发也不冲突(随机部分 6 hex = 24 bit)。
 */
export function generatePrdSplitRunId(): string {
  const ts = Date.now().toString(36)
  const rnd = randomBytes(3).toString('hex')
  return `prd-${ts}-${rnd}`
}
