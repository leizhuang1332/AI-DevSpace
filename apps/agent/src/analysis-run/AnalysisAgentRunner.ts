/**
 * Analysis Agent Runner(issue 02 · ADR-0021)
 *
 * 直接调 Claude Agent SDK `query({prompt, options:{systemPrompt, mcpServers, allowedTools, cwd}})`,
 * 不走 AISession 包装(因为 Analysis Run 路径需要 systemPrompt **完全替换** +
 * 通过 in-process MCP server 注入业务工具)。
 *
 * 业务工具:
 * - \`report_analysis_issue\`(issue 03 完整协议;本期最小形态只接 title /
 *   description / sourceRefs / metadata)
 * - \`complete_analysis\`(无业务参数;调用后 Run 进入 completion_requested)
 *
 * 工具拦截:SDK 通过 MCP server 调用我们的 handler;handler 同步处理
 * (调 AnalysisRunService 持久化 + publish SSE)并返回结果。SDK 自动把
 * tool_result 喂回模型。
 *
 * SDK 流处理:
 * - text 事件 → 写 log.jsonl(text) + publish `analysis_run_log`
 * - tool_use 事件 → 写 log.jsonl(tool_use) + publish `analysis_run_log`
 * - tool_result 事件 → 写 log.jsonl(tool_result) + publish `analysis_run_log`
 * - result(success) → 门禁检查后 transitionToSucceeded + publish `analysis_run_succeeded`
 * - result(error_*)/error → transitionToFailed + publish `analysis_run_failed`
 *
 * 测试时:把 queryFn 替换为 fake(可控 SDK envelope 流);fake 不暴露
 * MCP server 路径,而是用 envelope 中的 tool_use 块直接调我们的 handler,
 * 我们也支持"直接调用业务 handler 路径"。两种入口同一行为。
 */

import type { AIProvider } from '../providers/AIProvider.js'
import type { SseHub } from '../sse/SseHub.js'
import type {
  AnalysisIssue,
  AnalysisLogEntry,
  SourceRef,
  IssueMetadata,
} from '@ai-devspace/shared'
import type { AnalysisRunService } from './AnalysisRunService.js'
import type { AnalysisPromptInput } from './AnalysisPromptAssembler.js'
import { assembleAnalysisSystemPrompt } from './AnalysisPromptAssembler.js'
import { redactLogEntry } from './runLogRedaction.js'
import {
  runAnalysisQueryWithRetry,
  type RunAnalysisQueryOutcome,
} from './runAnalysisQueryWithRetry.js'

/** 业务工具 name 常量 —— SDK MCP server 注册 / handler dispatch 共同使用 */
export const TOOL_REPORT_ISSUE = 'report_analysis_issue'
export const TOOL_COMPLETE_ANALYSIS = 'complete_analysis'

/** AnalysisAgentRunner 注入依赖 */
export interface AnalysisRunnerDeps {
  workspaceRoot: string
  provider: AIProvider
  runService: AnalysisRunService
  hub: SseHub
  /** Skill 正文(本期直接由 route 注入;失败 / 缺失 → 退化到"(empty)") */
  skillBody: string
  /** Skill 元数据(name / description / version) */
  skillMeta: AnalysisPromptInput['skill']
  /** 第八层(已答复需求上下文) —— 暂为空数组(完整闭环在 issue 04) */
  answeredContext: AnalysisPromptInput['answered_context']
  /** 第九层(当前运行范围) */
  scope: AnalysisPromptInput['scope']
  /** SDK cwd(指向非 git 目录,沿用 analysis.ts 的 resolveAnalysisSdkCwd 模式) */
  cwd: string
  /** reqId + runId(用于 SSE 路由 + 持久化定位) */
  requirementId: string
  runId: string
  /** SDK session topic(注入到 AISession / SDK) */
  topic: string
  /**
   * issue 07:取消信号(可选)。当前 agent 不暴露取消端点,但接口预留;
   * `runAnalysisQueryWithRetry` 在 `aborted` 时会抛 AbortError 终止重试循环。
   */
  signal?: AbortSignal
}

/** Issue 报告工具输入(平台校验) */
export interface ReportIssueToolInput {
  title: string
  description: string
  sourceRefs: SourceRef[]
  metadata?: IssueMetadata
}

/** Issue 报告工具结果(回给模型) */
export interface ReportIssueToolResult {
  accepted: boolean
  issue_id: string
  ordinal: number
  duplicate?: boolean
}

/** 完成工具结果 */
export interface CompleteToolResult {
  accepted: boolean
}

/**
 * 直接调 SDK query 跑 Analysis Run 的单 query runner。
 *
 * **不**走 ClaudeCodeProvider.createSession + AISession 路径 —— 那个路径
 * 假设 system prompt 走 appendSystemPrompt;本路径需要完全替换。
 *
 * 简化:复用 provider 的 `ccSwitch` / `cwd` 注入能力(SDK 子进程 env),
 * 但绕过 AISession 的 assembler + retry loop,直接读 SDK envelope。
 *
 * **重要**:此函数返回 { ok: true } 表示成功门禁已满足 → Run 进入 succeeded;
 * 任何 SDK 错误 / 未调用 complete_analysis / 持久化失败 → 返 { ok: false }。
 */
export async function runAnalysisQuery(deps: AnalysisRunnerDeps): Promise<
  | { ok: true; issue_count: number }
  | { ok: false; error: string }
> {
  const {
    provider,
    runService,
    hub,
    skillBody,
    skillMeta,
    answeredContext,
    scope,
    cwd,
    requirementId,
    runId,
    topic,
    signal,
  } = deps

  const systemPrompt = assembleAnalysisSystemPrompt({
    skill: skillMeta,
    skill_body: skillBody,
    answered_context: answeredContext,
    scope,
  })

  // 仅当 provider 没有 runAnalysisQuery 时才创建 AISession(向后兼容)
  // 大多数 Provider(包括 ClaudeCodeProvider)都暴露 runAnalysisQuery,
  // 直接走 SDK query 而不需要 AISession 包装。
  if (typeof provider.runAnalysisQuery !== 'function') {
    const session = await provider.createSession(requirementId, {
      topic,
      kind: 'task',
      cwd,
    })
    try {
      await session.close()
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: 'provider does not support runAnalysisQuery (test fake?)',
    }
  }

  // 业务工具 handler:同步处理 + 返回 tool_result
  const reportIssueHandler = makeReportIssueHandler({
    runService,
    hub,
    requirementId,
    runId,
  })
  const completeHandler = makeCompleteAnalysisHandler({
    runService,
    hub,
    requirementId,
    runId,
  })

  const logCtx = { requirementId, runId, hub, runService }
  // tool_use_id → 工具名 反向映射(SDK 流顺序:tool_use 先到,tool_result 后到;
  // 这里用本 Run 的局部 Map,Run 结束随 runner 销毁,不跨 Run 共享)
  const toolNameByUseId = new Map<string, string>()

  // issue 07:把 provider.runAnalysisQuery 包成 rawRun(每次 attempt 调一次)
  // - 同 runId 不变(由调用方 route 决定,不在此处重写)
  // - 临时错误自动重试(最多 4 次 attempt,3 次重试)
  // - 永久错误立即终止
  const queryInput: import('../providers/AIProvider.js').AnalysisQueryInput = {
    prompt: buildRunQueryPrompt({ scope }),
    systemPrompt,
    cwd,
    onEvent: (envelope: unknown) => {
      const m = envelope as Record<string, unknown>
      const wrapped: SdkMessageLike = {
        kind: 'raw',
        raw: m,
      }
      handleSdkEnvelope({
        envelope: wrapped,
        requirementId,
        runId,
        logCtx,
        reportIssueHandler,
        completeHandler,
        toolNameByUseId,
      })
    },
    // SDK 工具注册:业务工具通过 MCP server 注入,Allowed tools = Read/Glob/Grep
    allowedTools: ['Read', 'Glob', 'Grep'],
    businessTools: {
      [TOOL_REPORT_ISSUE]: reportIssueHandler,
      [TOOL_COMPLETE_ANALYSIS]: completeHandler,
    },
  }

  const sdkResult = await runAnalysisQueryWithRetry(
    (attempt: number): Promise<RunAnalysisQueryOutcome> =>
      // issue_count 当前由 AnalysisAgentRunner 在成功后从 meta 读,
      // 不在 provider 返回里;这里固定返 0,后续由 transitionToSucceeded
      // 拿 meta.issue_count(decision 31)
      provider.runAnalysisQuery!(queryInput).then(
        (r): RunAnalysisQueryOutcome =>
          r.ok
            ? { ok: true, issue_count: 0 }
            : { ok: false, error: r.error },
      ),
    {
      signal,
      onRetry: ({ classification, attempt: retryAttempt, delayMs, error }) => {
        // 退避前发布 SSE 事件;Web 端可显示"正在重试第 N 次"提示
        // narrowing:onRetry 只在 retryable=true 时触发(RetryStrategy 契约),
        // 可重试分类是 A/C/D,故 category 在此分支是 'A' | 'C' | 'D' 之一。
        // 通过 assertNever 把 B/E/cancelled 拒在编译期外。
        const retryCategory = toRetryCategory(classification.category)
        hub.publish(requirementId, {
          type: 'analysis_run_retrying',
          reqId: requirementId,
          runId,
          ts: Date.now(),
          attempt: retryAttempt,
          category: retryCategory,
          retryable: classification.retryable,
          delayMs,
          error,
        })
      },
    },
  )

  // 关闭 session(本期分析路径不再依赖 AISession,保留兼容钩子)
  // No-op:Analysis Run 路径不持有 AISession,无需清理。

  // issue 07:把 SDK 终态失败 + 持久化失败等"throw"路径统一在 runner 内
  // 转 transitionToFailed 兜底。避免 route 层 catch 重复兜底(可能在
  // transitionToSucceeded 已执行后再次 transitionToFailed 失败造成竞态)。
  const failFast = (reason: string) => {
    const failureReason = reason
    const failedResult = runService.transitionToFailed(requirementId, runId, failureReason)
    if (failedResult.ok) {
      hub.publish(requirementId, {
        type: 'analysis_run_failed',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        finishedAt: failedResult.run.finished_at ?? new Date().toISOString(),
        error: failureReason,
        issueCount: failedResult.run.issue_count,
      })
    }
    void runService.releaseStartupLock(requirementId).catch(() => {})
  }

  if (!sdkResult.ok) {
    // SDK 终态失败 → transitionToFailed + publish + 释放 startup lock
    failFast(sdkResult.error ?? 'SDK execution failed')
    return { ok: false, error: sdkResult.error ?? 'SDK execution failed' }
  }

  // SDK 成功 → 检查完成门禁:已 requestCompletion?否则视为失败
  // (decision 31:必须显式完成工具调用 + SDK 成功 + 持久化完成 才算 succeeded)
  let meta: ReturnType<typeof runService.readMeta>
  try {
    meta = runService.readMeta(requirementId, runId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failFast(`run meta read failed: ${message}`)
    return { ok: false, error: message }
  }
  if (!meta) {
    const reason = 'run meta disappeared'
    failFast(reason)
    return { ok: false, error: reason }
  }
  if (meta.status !== 'running') {
    // 可能在 SDK 错误路径已转换(理论上不应在此分支)
    const reason = `unexpected status=${meta.status}`
    failFast(reason)
    return { ok: false, error: reason }
  }
  // 检查是否已 requestCompletion —— 通过查询分析服务内部状态
  if (!runService.isCompletionRequested(runId)) {
    const reason = 'SDK returned success but complete_analysis was not called'
    failFast(reason)
    return { ok: false, error: reason }
  }

  // 持久化已完成(appendFileSync 即时 fsync) → 切换 succeeded + 释放 startup lock
  // try/catch 包住 transitionToSucceeded 自身抛错的极端情况(原子写失败等)
  let succeeded: ReturnType<typeof runService.transitionToSucceeded>
  try {
    succeeded = runService.transitionToSucceeded(requirementId, runId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failFast(`transitionToSucceeded persist failed: ${message}`)
    return { ok: false, error: message }
  }
  if (!succeeded.ok) {
    void runService.releaseStartupLock(requirementId).catch(() => {})
    return { ok: false, error: succeeded.reason }
  }
  hub.publish(requirementId, {
    type: 'analysis_run_succeeded',
    reqId: requirementId,
    runId,
    ts: Date.now(),
    finishedAt: succeeded.run.finished_at ?? new Date().toISOString(),
    issueCount: succeeded.run.issue_count,
  })
  await runService.releaseStartupLock(requirementId)
  return { ok: true, issue_count: succeeded.run.issue_count }
}

/**
 * 构造 SDK query 的用户输入(决策 17 第 9 层)。
 *
 * 注:本提示词在 SDK query() 中作为"用户输入"传递;
 * systemPrompt 已经包含完整九层 —— 这里的 user prompt 只负责:
 * 1) 明确告诉模型"请使用本次 Analysis Skill"
 * 2) 提供可读取的 PRD / repo 路径提示
 * 3) 强调完成协议
 */
function buildRunQueryPrompt(input: { scope: AnalysisPromptInput['scope'] }): string {
  const { scope } = input
  return [
    '请按当前 Analysis Skill 的识别目标,逐条检查以下 Requirement 内容,并通过',
    '`report_analysis_issue` 报告每一条问题;检查完成后调用 `complete_analysis`。',
    '',
    `- Requirement id:**${scope.requirement_id}**`,
    `- 关联 Repository:${scope.repo_names.length === 0 ? '(无)' : scope.repo_names.map((n) => `\`${n}\``).join(', ')}`,
    '- PRD Markdown 已在 system prompt 第 9 层给出;使用 `Read` / `Glob` / `Grep` 工具读取需要进一步核对的代码或文档。',
    '',
    '完成后**必须**调用 `complete_analysis`(无业务参数);',
    '否则 Run 会被平台判失败并保留已接收的部分 Issue。',
  ].join('\n')
}

// ============================================================================
// 业务工具 handler 工厂
// ============================================================================

/** report_analysis_issue 工具 handler —— 同步接受 + 持久化 + SSE publish */
function makeReportIssueHandler(ctx: {
  runService: AnalysisRunService
  hub: SseHub
  requirementId: string
  runId: string
}) {
  const { runService, hub, requirementId, runId } = ctx
  return (toolUseId: string, input: unknown): ReportIssueToolResult => {
    const parsed = parseReportIssueInput(input)
    if (!parsed.ok) {
      return { accepted: false, issue_id: '', ordinal: 0 }
    }
    const result = runService.reportIssue({
      requirementId,
      runId,
      toolUseId,
      input: parsed.value,
    })
    if (!result.ok) {
      // run_not_found / run_not_running / run_completed:模型侧应停止报告
      return { accepted: false, issue_id: '', ordinal: 0 }
    }
    const { issue, created } = result.result
    if (created) {
      hub.publish(requirementId, {
        type: 'analysis_issue_reported',
        reqId: requirementId,
        runId,
        ts: Date.now(),
        issue,
      })
    }
    return {
      accepted: true,
      issue_id: issue.issue_id,
      ordinal: issue.ordinal,
      duplicate: !created,
    }
  }
}

/** complete_analysis 工具 handler —— 严格拒绝非空入参 + 进入 completion_requested */
function makeCompleteAnalysisHandler(ctx: {
  runService: AnalysisRunService
  hub: SseHub
  requirementId: string
  runId: string
}) {
  const { runService } = ctx
  return (_toolUseId: string, input: unknown): CompleteToolResult => {
    // 决策 30:complete_analysis 不接受业务参数 —— 严格拒绝非空 input
    if (!isEmptyArgs(input)) {
      return { accepted: false }
    }
    const result = runService.requestCompletion(ctx.requirementId, ctx.runId)
    return { accepted: result.ok }
  }
}

/**
 * 判定"空入参" —— 工具 input 应为 undefined / null / `{}`(允许 JSON 空对象)。
 * 任何字段(包括 0 / false / 空字符串)都被视为非空入参。
 */
function isEmptyArgs(input: unknown): boolean {
  if (input === undefined || input === null) return true
  if (typeof input !== 'object') return false
  if (Array.isArray(input)) return false
  return Object.keys(input as Record<string, unknown>).length === 0
}

/**
 * 工具输入 Schema 校验(决策 25)。
 *
 * 失败时返回 ok:false;handler 不向模型返回详细错误(避免模型陷入重试循环),
 * 而是通过 result.accepted=false 让模型自行决定是否调整。
 */
function parseReportIssueInput(
  input: unknown,
):
  | {
      ok: true
      value: {
        title: string
        description: string
        sourceRefs: SourceRef[]
        metadata?: IssueMetadata
      }
    }
  | { ok: false; reason: string } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'input not object' }
  const o = input as Record<string, unknown>
  if (typeof o.title !== 'string' || o.title.trim().length === 0) {
    return { ok: false, reason: 'title missing' }
  }
  if (typeof o.description !== 'string' || o.description.trim().length === 0) {
    return { ok: false, reason: 'description missing' }
  }
  if (!Array.isArray(o.sourceRefs) || o.sourceRefs.length === 0) {
    return { ok: false, reason: 'sourceRefs missing' }
  }
  // sourceRefs 形态严格按 SourceRefSchema;此处只做最浅校验(由 shared schema 兜底)
  const sourceRefs: SourceRef[] = []
  for (const r of o.sourceRefs) {
    if (!r || typeof r !== 'object') return { ok: false, reason: 'bad sourceRef' }
    sourceRefs.push(r as SourceRef)
  }
  let metadata: IssueMetadata | undefined
  if (o.metadata !== undefined) {
    if (!Array.isArray(o.metadata)) return { ok: false, reason: 'metadata not array' }
    metadata = o.metadata as IssueMetadata
  }
  return {
    ok: true,
    value: {
      title: o.title,
      description: o.description,
      sourceRefs,
      metadata,
    },
  }
}

// ============================================================================
// SDK envelope 处理:把 SDK 流事件落到 log.jsonl + 触发业务工具 handler
// ============================================================================

/** SDK envelope 形态抽象 —— ClaudeCodeProvider 转换后给我们的形态 */
export interface SdkMessageLike {
  kind: string
  [k: string]: unknown
}

interface LogCtx {
  requirementId: string
  runId: string
  hub: SseHub
  runService: AnalysisRunService
}

interface HandleCtx {
  envelope: SdkMessageLike
  requirementId: string
  runId: string
  logCtx: LogCtx
  reportIssueHandler: (toolUseId: string, input: unknown) => ReportIssueToolResult
  completeHandler: (toolUseId: string, input: unknown) => CompleteToolResult
  /**
   * tool_use_id → 工具名 映射(issue 06 决策 37 + 验收 7:tool_result entry
   * 需要回填实际工具名,而不是写死 'tool_result',便于 UI / 审计查看哪个
   * 工具产生了该结果)。SDK 流顺序先 tool_use 后 tool_result,所以
   * tool_use 阶段填,tool_result 阶段读。
   */
  toolNameByUseId: Map<string, string>
}

/**
 * 把 SDK 流事件分派到:
 * - log.jsonl 持久化(text / tool_use / tool_result)
 * - 业务工具拦截(report_analysis_issue / complete_analysis)
 *
 * 注意:SDK 顺序可能先发 tool_use 后发 tool_result;
 * 业务工具 handler 在 tool_use 阶段同步执行,tool_result 阶段只落日志。
 */
function handleSdkEnvelope(ctx: HandleCtx): void {
  const { envelope } = ctx
  const ts = new Date().toISOString()

  // ClaudeCodeProvider.runAnalysisQuery 透传 {kind:'raw', raw:<SDKMessage>}
  // 我们在这里 narrow 出文本 / 工具事件
  if (envelope.kind === 'raw') {
    const raw = (envelope.raw as Record<string, unknown>) ?? {}
    const type = raw['type'] as string | undefined

    // 文本:assistant / partial_assistant
    if (type === 'assistant' || type === 'partial_assistant') {
      const message = raw['message'] as Record<string, unknown> | undefined
      const content = Array.isArray(message?.['content'])
        ? (message!['content'] as Array<Record<string, unknown>>)
        : []
      const text = content
        .filter((b) => b['type'] === 'text')
        .map((b) => String(b['text'] ?? ''))
        .join('')
      if (text.length === 0) return
      const entry: AnalysisLogEntry = { kind: 'text', ts, text }
      appendLog(ctx, entry)
      return
    }

    // 工具调用:content_block_delta with tool_use 或顶层 tool_use block
    if (type === 'content_block_start') {
      const block = raw['content_block'] as Record<string, unknown> | undefined
      if (block && block['type'] === 'tool_use') {
        const toolUseId = String(block['id'] ?? '')
        const name = String(block['name'] ?? '')
        const input = block['input'] ?? {}
        // 记录 tool_use_id → name 映射,供 tool_result 阶段回填实际工具名
        if (toolUseId) ctx.toolNameByUseId.set(toolUseId, name)
        const entry: AnalysisLogEntry = {
          kind: 'tool_use',
          ts,
          tool_use_id: toolUseId,
          name,
          input,
        }
        appendLog(ctx, entry)
        if (name === TOOL_REPORT_ISSUE) {
          ctx.reportIssueHandler(toolUseId, input)
        } else if (name === TOOL_COMPLETE_ANALYSIS) {
          ctx.completeHandler(toolUseId, input)
        }
      }
      return
    }

    // 工具结果:SDK 直接推 mcp 工具的 tool_result(无独立 envelope)
    if (type === 'user' || type === 'tool_result') {
      const message = raw['message'] as Record<string, unknown> | undefined
      const content = Array.isArray(message?.['content'])
        ? (message!['content'] as Array<Record<string, unknown>>)
        : []
      for (const block of content) {
        if (block['type'] !== 'tool_result') continue
        const toolUseId = String(block['tool_use_id'] ?? '')
        // 回填实际工具名(SDK tool_result block 不带 name):从 tool_use 阶段
        // 记录的反向映射查;查不到 → 退化为 'tool_result'(决策 37:保留可读性)
        const resolvedName =
          ctx.toolNameByUseId.get(toolUseId) ?? 'tool_result'
        const entry: AnalysisLogEntry = {
          kind: 'tool_result',
          ts,
          tool_use_id: toolUseId,
          name: resolvedName,
          output: block['content'],
        }
        appendLog(ctx, entry)
      }
      return
    }

    // 其他类型(result / error / system / retrying)不落 log(decision 37)
    return
  }

  // 直接 envelope 形态(测试 fake provider 可走这条)
  switch (envelope.kind) {
    case 'partial_assistant':
    case 'assistant': {
      const text = (envelope.text as string | undefined) ?? ''
      if (text.length === 0) return
      const entry: AnalysisLogEntry = { kind: 'text', ts, text }
      appendLog(ctx, entry)
      return
    }
    case 'tool_use': {
      const toolUseId = String(envelope.tool_use_id ?? '')
      const name = String(envelope.tool_name ?? '')
      const input = envelope.tool_input
      // 记录 tool_use_id → name 映射,供 tool_result 阶段回填实际工具名
      if (toolUseId) ctx.toolNameByUseId.set(toolUseId, name)
      const entry: AnalysisLogEntry = {
        kind: 'tool_use',
        ts,
        tool_use_id: toolUseId,
        name,
        input,
      }
      appendLog(ctx, entry)
      if (name === TOOL_REPORT_ISSUE) {
        ctx.reportIssueHandler(toolUseId, input)
      } else if (name === TOOL_COMPLETE_ANALYSIS) {
        ctx.completeHandler(toolUseId, input)
      }
      return
    }
    case 'tool_result': {
      const toolUseId = String(envelope.tool_use_id ?? '')
      // envelope 自带 tool_name 时直接用;否则查 tool_use 阶段记录的反向映射;
      // 都查不到时退化为 'tool_result'(决策 37:保留可读性)
      const resolvedName =
        String(envelope.tool_name ?? '') ||
        ctx.toolNameByUseId.get(toolUseId) ||
        'tool_result'
      const output = envelope.tool_output
      const entry: AnalysisLogEntry = {
        kind: 'tool_result',
        ts,
        tool_use_id: toolUseId,
        name: resolvedName,
        output,
      }
      appendLog(ctx, entry)
      return
    }
    default:
      return
  }
}

function appendLog(ctx: HandleCtx, entry: AnalysisLogEntry): void {
  // issue 06 · ADR-0021 决策 38:在落盘和 SSE 发布之前做统一脱敏。
  // 入口脱敏确保 persistence 与 SSE 拿到的是同一份(决策 38:服务端
  // 落盘前与 SSE 发布前使用同一份脱敏内容,不允许前端遮盖兜底)。
  // 脱敏异常回退到原 entry → 写盘;AnalysisRunService.appendLogEntry 兜底
  // 第二次脱敏。两次都失败的概率极低,但失败时 log.jsonl 内可能包含
  // 未脱敏内容 —— 已在 services 层加 risk 注释;允许本期 best-effort。
  const sanitized = redactLogEntry(entry)
  const result = ctx.logCtx.runService.appendLogEntry(
    ctx.requirementId,
    ctx.runId,
    sanitized,
  )
  if (!result.ok) return
  ctx.logCtx.hub.publish(ctx.requirementId, {
    type: 'analysis_run_log',
    reqId: ctx.requirementId,
    runId: ctx.runId,
    ts: Date.now(),
    entry: sanitized,
  })
}

/**
 * Issue 报告工具输入解析(从 SDK MCP server handler 入口)。
 *
 * 此处导出便于 route 层在收到 SDK envelope 时直接复用。
 */
export function parseReportIssueInputPublic(input: unknown) {
  return parseReportIssueInput(input)
}

// 让 AnalysisRunService 暴露 isCompletionRequested(由 Runner 门禁用)
declare module './AnalysisRunService.js' {
  interface AnalysisRunService {
    isCompletionRequested(runId: string): boolean
  }
}

/**
 * Narrow `ErrorCategory` 到 SSE 事件允许的 'A' | 'C' | 'D'。
 *
 * `runAnalysisQueryWithRetry.onRetry` 只在 `classification.retryable=true` 时
 * 触发,而 retryable=true 的分类是 A/C/D(由 classifyProviderError 决定)。
 * 这里在编译期把 B/E/cancelled 拒掉,代替 unsafe `as` cast。
 */
function toRetryCategory(category: import('../error/ErrorClassifier.js').ErrorCategory): 'A' | 'C' | 'D' {
  if (category === 'A' || category === 'C' || category === 'D') return category
  throw new Error(
    `toRetryCategory: expected A|C|D, got ${String(category)} ` +
      `(this should be unreachable; onRetry only fires for retryable classifications)`,
  )
}