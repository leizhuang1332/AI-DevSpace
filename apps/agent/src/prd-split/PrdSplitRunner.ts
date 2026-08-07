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

/**
 * BOARD 工位语义 description(issue 13 修复):
 *
 * 旧硬编码 `Analysis Run 业务工具:propose_card。由 AnalysisAgentRunner 在 handler
 * 内执行持久化`,在 PrdSplitRunner 路径下语义错位 —— system prompt 说的是 BOARD
 * 工位 PRD 拆解助手,但工具 metadata 自称 Analysis Run,模型会谨慎 end_turn。
 *
 * 现 caller 注入后,工具描述与 system prompt 身份一致,模型能正确识别。
 */
export const BOARD_PROPOSE_CARD_DESCRIPTION =
  'BOARD 工位 PRD 拆解 Run 业务工具:propose_card。由 PrdSplitRunner 在 handler 内执行候选卡片持久化(写 cards.yaml 并 publish SSE);不支持 status 字段、不接受 suggested_status。建议每识别一张候选卡片立即调用一次。'

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
    // issue 13:BOARD 工位语义 description(对齐 system prompt 身份,避免
    // 默认 Analysis Run 字样让模型谨慎 end_turn → 0 卡静音成功)
    businessToolDescriptions: {
      [TOOL_PROPOSE_CARD]: BOARD_PROPOSE_CARD_DESCRIPTION,
    },
    // issue 13:onEvent 改为 stderr 日志(可观测 envelope 流向,辅助排障)
    //
    // 0 卡诊断关键信号:
    // - 看到 type=assistant + content 含 propose_card → 模型真的在调
    // - 看到 type=assistant 没 propose_card 内容,但 text 字段是结束语
    //   → 模型读了 description 仍选择不调(描述修复未生效或语义模糊)
    // - 看不到 type=assistant → SDK 层 / model 层根本没发起对话
    // - type=tool_use.name=propose_card + type=tool_result → wrapper 链通
    onEvent: (env) => {
      const m = env as { kind?: string; raw?: Record<string, unknown> }
      if (m.kind !== 'raw' || !m.raw) return
      const type = m.raw['type']
      if (type === 'assistant') {
        // assistant message 含多个 content block;关心 thinking / text / tool_use
        const message = (m.raw as { message?: { content?: unknown[] } }).message
        const content = Array.isArray(message?.content) ? message!.content : []
        const summary = content
          .map((b) => {
            const block = b as Record<string, unknown>
            if (block['type'] === 'text') {
              const t = String(block['text'] ?? '')
              return `text(${t.slice(0, 200)})${t.length > 200 ? '...' : ''}`
            }
            if (block['type'] === 'thinking') {
              const t = String(block['thinking'] ?? '')
              return `thinking(${t.slice(0, 120)}...)`
            }
            if (block['type'] === 'tool_use') {
              return `tool_use(name=${String(block['name'] ?? '')}, toolUseId=${String(block['id'] ?? '').slice(0, 40)})`
            }
            return `block(${block['type']})`
          })
          .join(' | ')
        process.stderr.write(
          `[prd-split sdk] runId=${runId} ASSISTANT ${summary || '(empty)'}\n`,
        )
      } else if (type === 'user') {
        // user message 一般是 tool_result 回喂
        const message = (m.raw as { message?: { content?: unknown[] } }).message
        const content = Array.isArray(message?.content) ? message!.content : []
        const ids = content
          .filter(
            (b) =>
              typeof b === 'object' &&
              b !== null &&
              (b as Record<string, unknown>)['type'] === 'tool_result',
          )
          .map((b) =>
            String((b as Record<string, unknown>)['tool_use_id'] ?? '').slice(
              0,
              40,
            ),
          )
          .join(',')
        process.stderr.write(
          ids
            ? `[prd-split sdk] runId=${runId} USER tool_result toolUseIds=${ids}\n`
            : '',
        )
      } else if (type === 'result') {
        process.stderr.write(
          `[prd-split sdk] runId=${runId} RESULT subtype=${String(m.raw['subtype'] ?? '')}\n`,
        )
      }
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
  // issue 13 修复#2-A 联动:0 卡回退路径里 transitionToSucceeded 内部已写
  // status='failed'(返 ok:true 但 run.status 是 failed)。这里识别语义、
  // 重新映射 SSE 事件,避免发布 prd_split_succeeded + actualCount=0 的错位。
  if (succeeded.run.status !== 'succeeded') {
    const errorMsg =
      succeeded.run.error ?? 'model produced 0 candidates (propose_card never invoked)'
    hub.publish(requirementId, {
      type: 'prd_split_failed',
      reqId: requirementId,
      runId,
      ts: Date.now(),
      finishedAt: succeeded.run.finished_at ?? new Date().toISOString(),
      error: errorMsg,
      actualCount: succeeded.run.actual_count,
    })
    await service.releaseLock(requirementId).catch(() => {})
    return { ok: false, error: errorMsg }
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
