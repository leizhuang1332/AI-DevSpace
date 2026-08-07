/**
 * PrdSplitRunner —— PRD 拆解 Run 的 SDK query runner(issue 05 / ADR-0027 D4)
 *
 * 镜像 `analysis-run/AnalysisAgentRunner.runAnalysisQuery:117` 但更简:
 * - 无 retry wrapper(PRD 拆解失败用户重触发即可,不自动重试)
 * - 无 `handleSdkEnvelope` log dispatch(本期不落 run log;cards.yaml 是唯一 artifact)
 * - 无 `complete_analysis` 门禁 —— 生成式 Run,模型发完所有卡正常 end turn
 *   即完成(SDK `result subtype=success` 即完成信号)
 *
 * 直接调 `provider.runAnalysisQuery`(底层 SDK query 入口),**不动**
 * ClaudeCodeProvider / createSdkMcpServer / mcpCallCounter(ADR-0023 zero-touch)。
 *
 * 业务工具:
 * - `propose_card`(单卡单调)—— 同步调 `service.appendProposal` + publish SSE
 *
 * allowedTools:`['Read','Glob','Grep','mcp__analysis__propose_card']`
 * (MCP server key `analysis` 硬编码在 ClaudeCodeProvider.ts:551,我的工具
 * 自动注册为 `mcp__analysis__propose_card`)。
 */

import type { AIProvider, AnalysisQueryInput } from '../providers/AIProvider.js'
import type { SseHub } from '../sse/SseHub.js'
import type {
  PrdSplitGranularityT,
  PrdSplitProposal,
} from '@ai-devspace/shared'
import type { PrdSplitService } from './PrdSplitService.js'

/** 业务工具 name 常量 —— SDK allowedTools + handler dispatch 共同使用 */
export const TOOL_PROPOSE_CARD = 'propose_card'

/** propose_card handler 入参(由 handler 本地 Zod 校验,wrapper 不过滤) */
export interface ProposeCardArgs {
  title: string
  content?: string
  suggested_priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  labels?: string[]
}

/** propose_card handler 返参(回给模型;wrapper stringify 成 text content block) */
export interface ProposeCardToolResult {
  accepted: boolean
  ordinal?: number
  reason?: string
}

/** PrdSplitRunner 注入依赖 */
export interface PrdSplitRunnerDeps {
  provider: AIProvider
  service: PrdSplitService
  hub: SseHub
  systemPrompt: string
  prompt: string
  cwd: string
  requirementId: string
  runId: string
}

/**
 * 跑一次 PRD 拆解 Run。
 *
 * **不**走 AnalysisAgentRunner —— 那个强绑 report_analysis_issue /
 * complete_analysis / AnalysisRunService / 九层 Skill prompt。本 runner 是
 * PRD 拆解专用,产物落 `analysis/proposals/<run-id>/cards.yaml`。
 *
 * 返回 `{ ok: true, actual_count } | { ok: false, error }`;终态转换 + SSE
 * publish + 锁释放由本函数负责(route 层 fire-and-forget)。
 */
export async function runPrdSplitQuery(
  deps: PrdSplitRunnerDeps,
): Promise<
  | { ok: true; actual_count: number }
  | { ok: false; error: string }
> {
  const { provider, service, hub, systemPrompt, prompt, cwd, requirementId, runId } = deps

  // type-guard:provider 必须实现 runAnalysisQuery(镜像 AnalysisAgentRunner:146)
  if (typeof provider.runAnalysisQuery !== 'function') {
    const error = 'provider does not support runAnalysisQuery (test fake?)'
    const failed = service.transitionToFailed(requirementId, runId, error)
    if (failed.ok) {
      hub.publish(requirementId, {
        type: 'prd_split_failed',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        finishedAt: failed.run.finished_at ?? new Date().toISOString(),
        error,
        actualCount: failed.run.actual_count,
      })
    }
    await service.releaseLock(requirementId).catch(() => {})
    return { ok: false, error }
  }

  // 业务工具 handler
  const proposeCardHandler = makeProposeCardHandler({
    service,
    hub,
    requirementId,
    runId,
  })

  const queryInput: AnalysisQueryInput = {
    prompt,
    systemPrompt,
    cwd,
    allowedTools: ['Read', 'Glob', 'Grep', `mcp__analysis__${TOOL_PROPOSE_CARD}`],
    businessTools: {
      [TOOL_PROPOSE_CARD]: proposeCardHandler,
    },
    // 本期不落 run log;onEvent 仅作可选 SSE 推送(模型 thinking 文本)
    onEvent: () => {
      /* no-op:cards.yaml 是唯一 artifact */
    },
  }

  let result: { ok: true } | { ok: false; error: string }
  try {
    result = await provider.runAnalysisQuery(queryInput)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const failed = service.transitionToFailed(requirementId, runId, error)
    if (failed.ok) {
      hub.publish(requirementId, {
        type: 'prd_split_failed',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        finishedAt: failed.run.finished_at ?? new Date().toISOString(),
        error,
        actualCount: failed.run.actual_count,
      })
    }
    await service.releaseLock(requirementId).catch(() => {})
    return { ok: false, error }
  }

  if (!result.ok) {
    const error = result.error ?? 'SDK execution failed'
    const failed = service.transitionToFailed(requirementId, runId, error)
    if (failed.ok) {
      hub.publish(requirementId, {
        type: 'prd_split_failed',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        finishedAt: failed.run.finished_at ?? new Date().toISOString(),
        error,
        actualCount: failed.run.actual_count,
      })
    }
    await service.releaseLock(requirementId).catch(() => {})
    return { ok: false, error }
  }

  // SDK 成功 → 切 succeeded + publish + 释放锁
  const succeeded = service.transitionToSucceeded(requirementId, runId)
  if (!succeeded.ok) {
    // meta 消失 / 状态不合法 → 兜底 failed
    const failed = service.transitionToFailed(
      requirementId,
      runId,
      `transitionToSucceeded failed: ${succeeded.reason}`,
    )
    if (failed.ok) {
      hub.publish(requirementId, {
        type: 'prd_split_failed',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        finishedAt: failed.run.finished_at ?? new Date().toISOString(),
        error: succeeded.reason,
        actualCount: failed.run.actual_count,
      })
    }
    await service.releaseLock(requirementId).catch(() => {})
    return { ok: false, error: succeeded.reason }
  }
  hub.publish(requirementId, {
    type: 'prd_split_succeeded',
    reqId: requirementId,
    runId,
    ts: Date.now(),
    finishedAt: succeeded.run.finished_at ?? new Date().toISOString(),
    actualCount: succeeded.run.actual_count,
  })
  await service.releaseLock(requirementId).catch(() => {})
  return { ok: true, actual_count: succeeded.run.actual_count }
}

// ============================================================================
// 业务工具 handler 工厂(镜像 makeReportIssueHandler · AnalysisAgentRunner:398)
// ============================================================================

/**
 * PR-2 风格 export:e2e 测试需在真 provider 之外构造 handler(不走
 * runAnalysisQuery 全流程),验证 args 透传到 appendProposal 的链路。
 */
export function makeProposeCardHandler(ctx: {
  service: PrdSplitService
  hub: SseHub
  requirementId: string
  runId: string
}): (toolUseId: string, args: unknown) => ProposeCardToolResult {
  const { service, hub, requirementId, runId } = ctx
  return (toolUseId: string, args: unknown): ProposeCardToolResult => {
    const inputKeys =
      args && typeof args === 'object' && !Array.isArray(args)
        ? Object.keys(args as Record<string, unknown>).join(',')
        : `<${args === null ? 'null' : typeof args}>`
    const parsed = parseProposeCardInput(args)
    if (!parsed.ok) {
      process.stderr.write(
        `[prd-split] propose_card rejected runId=${runId} toolUseId=${toolUseId} reason=${parsed.reason} inputKeys=${inputKeys}\n`,
      )
      return { accepted: false, reason: parsed.reason }
    }
    const result = service.appendProposal({
      requirementId,
      runId,
      toolUseId,
      input: parsed.value,
    })
    if (!result.ok) {
      process.stderr.write(
        `[prd-split] appendProposal rejected runId=${runId} toolUseId=${toolUseId} code=${result.code} reason=${result.reason}\n`,
      )
      return { accepted: false, reason: result.code }
    }
    if (result.created) {
      hub.publish(requirementId, {
        type: 'prd_split_proposal_reported',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        proposal: result.proposal,
      })
    }
    return { accepted: true, ordinal: result.proposal.ordinal }
  }
}

/**
 * 工具输入校验(决策:handler 负责严格校验,因为 wrapper 对非
 * report_analysis_issue 工具走 z.object({}).passthrough() 不过滤)。
 *
 * 镜像 `parseReportIssueInput · AnalysisAgentRunner:507`;失败返 reason,
 * 不给模型详细错误(避免陷入重试循环),让模型自行调整。
 */
function parseProposeCardInput(
  input: unknown,
): { ok: true; value: ProposeCardArgs } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'input not object' }
  }
  const o = input as Record<string, unknown>
  if (typeof o.title !== 'string' || o.title.trim().length === 0) {
    return { ok: false, reason: 'title missing or empty' }
  }
  const value: ProposeCardArgs = { title: o.title }
  if (o.content !== undefined) {
    if (typeof o.content !== 'string') return { ok: false, reason: 'content must be string' }
    value.content = o.content
  }
  if (o.suggested_priority !== undefined && o.suggested_priority !== null) {
    const pr = o.suggested_priority
    if (
      pr !== 'low' &&
      pr !== 'medium' &&
      pr !== 'high' &&
      pr !== 'urgent'
    ) {
      return { ok: false, reason: 'suggested_priority invalid' }
    }
    value.suggested_priority = pr
  } else if (o.suggested_priority === null) {
    value.suggested_priority = null
  }
  if (o.labels !== undefined) {
    if (!Array.isArray(o.labels)) return { ok: false, reason: 'labels must be array' }
    for (const l of o.labels) {
      if (typeof l !== 'string') return { ok: false, reason: 'labels items must be string' }
    }
    value.labels = o.labels as string[]
  }
  return { ok: true, value }
}

/** 测试 seam export:直接调 parser(镜像 parseReportIssueInputPublic) */
export function parseProposeCardInputPublic(input: unknown) {
  return parseProposeCardInput(input)
}

/**
 * 装配 PRD 拆解 Run 的依赖元数据(供 route 层一次性构造 runner deps)。
 * 仅类型导出,实际 runner 调用由 route fire-and-forget 块。
 */
export interface PrdSplitRunStarterInput {
  requirementId: string
  granularity: PrdSplitGranularityT
  expectedCount: number
}

/** proposal 别名 re-export(便于 route 层 type narrow) */
export type { PrdSplitProposal }
