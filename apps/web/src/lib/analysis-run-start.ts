/**
 * Analysis Run 启动客户端 wrapper(issue 02 · ADR-0021)
 *
 * 调 `POST /api/requirements/<id>/analysis/start` 让 Agent 端创建一个新的
 * Analysis Run;成功 → SSE 推 analysis_run_created / analysis_issue_reported /
 * analysis_run_log / analysis_run_succeeded / analysis_run_failed 五类事件。
 *
 * 与 `analysis-start.ts`(ticket 05 旧 session 路径)互斥 —— 本期 ANALYZING
 * 工位只走 Analysis Run 路径;旧 endpoint 保留供历史会话回看。
 */

import { z } from 'zod'
import { agentFetch, AgentError } from './agent-client'

/** Agent `/analysis/start` 201 响应的 Zod schema(issue 02 决策 9) */
export const StartAnalysisRunResponseSchema = z.object({
  run_id: z.string().min(1),
  requirement_id: z.string().min(1),
  skill_name: z.string().min(1),
  created_at: z.string().min(1),
  status: z.literal('running'),
})
export type StartAnalysisRunSuccess = z.infer<
  typeof StartAnalysisRunResponseSchema
>

export interface StartAnalysisRunParams {
  /** 必填:所选 Analysis Skill 名称 */
  skill_name: string
}

export class StartAnalysisRunError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly code?: string,
  ) {
    super(
      `StartAnalysisRun ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
    this.name = 'StartAnalysisRunError'
  }
}

export async function startAnalysisRun(
  requirementId: string,
  params: StartAnalysisRunParams,
): Promise<StartAnalysisRunSuccess> {
  let raw: unknown
  try {
    raw = await agentFetch<StartAnalysisRunSuccess>(
      `/api/requirements/${encodeURIComponent(requirementId)}/analysis/start`,
      {
        method: 'POST',
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
      throw new StartAnalysisRunError(err.status, err.body, code)
    }
    throw err
  }
  return StartAnalysisRunResponseSchema.parse(raw)
}