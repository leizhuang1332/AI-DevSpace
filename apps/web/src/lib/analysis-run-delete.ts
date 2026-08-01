/**
 * Analysis Run 永久删除客户端 wrapper(issue 05 · ADR-0021 决策 42)
 *
 * 调 `DELETE /api/requirements/<id>/analysis/runs/<runId>` 让 Agent 端物理级联
 * 删除该 Run 的 meta / issues / log / responses 目录。成功(204) → SSE 推
 * `analysis_run_deleted` 事件通知其他标签同步刷新。
 *
 * 失败码:
 * - 401 未鉴权 → AgentError
 * - 404 analysis_run_not_found → Run 不存在(可能并发删除)
 * - 409 analysis_run_still_running → Run 还在跑(前端禁删入口 + 服务端兜底)
 * - 500 analysis_run_delete_failed → fs 删除失败
 */

import { z } from 'zod'
import { agentFetch, AgentError } from './agent-client'

/** DELETE 失败时的错误码(对应服务端响应 body.error) */
export const DeleteRunErrorCodes = [
  'analysis_run_not_found',
  'analysis_run_still_running',
  'analysis_run_delete_failed',
] as const
export type DeleteRunErrorCode = (typeof DeleteRunErrorCodes)[number]

export class DeleteAnalysisRunError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly code?: DeleteRunErrorCode,
  ) {
    super(
      `DeleteAnalysisRun ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
    this.name = 'DeleteAnalysisRunError'
  }
}

/** 失败响应的 zod schema(用于窄化 body.code) */
const DeleteRunErrorBodySchema = z.object({
  error: z.enum(DeleteRunErrorCodes).optional(),
  reason: z.string().optional(),
  run: z.unknown().optional(),
})

/**
 * 永久删除终态 Analysis Run。
 *
 * 返回 void(204 No Content);失败抛 `DeleteAnalysisRunError` 并携带 status /
 * code。`runId` 应在调用前通过列表确认存在 + 处于终态(避免 409 round-trip)。
 */
export async function deleteAnalysisRun(
  requirementId: string,
  runId: string,
): Promise<void> {
  try {
    await agentFetch<void>(
      `/api/requirements/${encodeURIComponent(requirementId)}/analysis/runs/${encodeURIComponent(runId)}`,
      { method: 'DELETE' },
    )
  } catch (err) {
    if (err instanceof AgentError) {
      const parsed = DeleteRunErrorBodySchema.safeParse(err.body)
      const code = parsed.success ? parsed.data.error : undefined
      throw new DeleteAnalysisRunError(err.status, err.body, code)
    }
    throw err
  }
}

/**
 * 是否可以删除给定 Run(纯前端门禁 · issue 05 验收 8)。
 *
 * - `running` → 不允许(对应后端 409)
 * - `succeeded` / `failed` → 允许
 */
export function canDeleteAnalysisRun(
  run: { status: import('@ai-devspace/shared').AnalysisRunMeta['status'] },
): boolean {
  return run.status !== 'running'
}