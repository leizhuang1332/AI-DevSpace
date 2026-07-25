/**
 * ANALYZING 工位 · 「开始分析」客户端 API wrapper(ticket 05 / ADR-0020 D9)
 *
 * 调 `POST /api/requirements/<id>/analysis/start` 让 Agent 端启动一个新
 * 分析会话;成功后 SSE 推 analysis_chunk 事件 → AdmissionDashboard 5
 * 维度卡 count 自然变化 → 按钮渲染条件 false 自然消失。
 *
 * 数据流:
 *   [Client] AdmissionDashboard 「开始分析」按钮 → startAnalysis(reqId, params)
 *   [Client → Agent] POST /api/requirements/<id>/analysis/start → 201
 *   [Agent] 落 sessions/<sid>/ + 启动 AISession 双 turn → 推 SseHub
 *   [Client → SSE] EventSource 收到 analysis_chunk → 追加到 chunksBySessionId
 *
 * 设计要点:
 * - 复用既有 `agentFetch`(由 `@/lib/agent-client` 暴露):bootstrap + 鉴权
 *   + 错误码透传三件事一并搞定,避免重复实现
 * - 出参 Zod 二次校验(与 `requirement-list.ts` / `repo-attach.ts` 同款)防
 *   后端契约漂移
 * - 失败 → 抛 `StartAnalysisError`,调用方根据 `.status` 与 `.code` 决定
 *   toast / 错误态;UI 层不抛(避开 Next.js error overlay)
 * - 不写 fallback / mock:成功即用服务端返回的 sessionId 拼本地 state,
 *   失败走原 client 错误路径(沿用 ticket 03 「fixture 化」原则)
 *
 * 关联:
 * - AdmissionDashboard ticket 05 (D9 触发 UI)
 * - start handler ticket 01 / ADR-0020 D8 双 turn 编排
 */

import { z } from 'zod'
import { agentFetch, AgentError } from './agent-client'
import type { AnalysisSessionAngle } from './analyzing'

// ============================================================================
// Schema(出参校验 — 与 requirement-list.ts / repo-attach.ts 同款)
// ============================================================================

/**
 * Agent `/analysis/start` 201 响应的 Zod schema。
 *
 * 与 Agent 端 `apps/agent/src/routes/analysis.ts` start handler 的 201
 * payload 字段一致(`ok / requirementId / sessionId / index_path /
 * chunks_path / started_at`);若后端契约漂移,parse 阶段失败抛 ZodError
 * 给上层处理。
 */
export const StartAnalysisResponseSchema = z.object({
  ok: z.literal(true),
  requirementId: z.string().min(1),
  sessionId: z.string().min(1),
  index_path: z.string().min(1),
  chunks_path: z.string().min(1),
  started_at: z.string().min(1),
})

export type StartAnalysisSuccess = z.infer<typeof StartAnalysisResponseSchema>

// ============================================================================
// 入参类型
// ============================================================================

/** 与 Agent 端 `StartBody` 兼容(apps/agent/src/routes/analysis.ts)。 */
export interface StartAnalysisParams {
  /** 必填:会话分析角度(白名单由 Agent 端校验,见 ANALYSIS_ANGLES) */
  angle: AnalysisSessionAngle
  /** 可选:展示用的会话名;不传则 Agent 端用 angle 默认 label */
  label?: string
  /** 可选:会话 id(由调用方预设);不传则 Agent 端生成 `sess-<angle>-<base36>` */
  session_id?: string
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * 启动分析失败的统一错误形状 —— 与 `agent-client.ts:AgentError` /
 * `requirement-list.ts:ListRequirementsError` 等邻居统一 super 模板:
 *   `<Verb> ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`
 *
 * `code` 字段由消费方按需区分(=`prd_not_ready` 引导 DRAFTING 等)。
 */
export class StartAnalysisError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly code?: string,
  ) {
    super(
      `StartAnalysis ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
    this.name = 'StartAnalysisError'
  }
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 启动一个分析会话。
 *
 * @param requirementId 目标需求 id
 * @param params 启动参数(angle 必填,label/session_id 可选)
 * @returns 服务端 201 响应内容(含 sessionId),经 Zod 二次校验
 * @throws {StartAnalysisError} 启动失败(参数错 / PRD 未就绪 / 服务端异常)
 * @throws {z.ZodError} 响应契约漂移(parse 失败)
 */
export async function startAnalysis(
  requirementId: string,
  params: StartAnalysisParams,
): Promise<StartAnalysisSuccess> {
  let raw: unknown
  try {
    raw = await agentFetch<StartAnalysisSuccess>(
      `/api/requirements/${encodeURIComponent(requirementId)}/analysis/start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      },
    )
  } catch (err) {
    if (err instanceof AgentError) {
      const code =
        typeof err.body === 'object' &&
        err.body !== null &&
        'error' in err.body &&
        typeof (err.body as { error: unknown }).error === 'string'
          ? (err.body as { error: string }).error
          : undefined
      throw new StartAnalysisError(err.status, err.body, code)
    }
    throw err
  }
  // 出参 schema 二次校验(防后端契约漂移)
  return StartAnalysisResponseSchema.parse(raw)
}
