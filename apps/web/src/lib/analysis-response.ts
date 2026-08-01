/**
 * Issue Response Web 客户端 wrapper(issue 04 · ADR-0021)
 *
 * 服务端契约:
 * - GET /api/requirements/<id>/analysis/runs/<runId>/issues/<issueId>/response
 *   → 200 { issue_id, run_id, body, created_at, updated_at, edit_version, answered }
 *   未填 → 200 with body='' + edit_version=0 + answered=false
 *
 * - PUT /api/requirements/<id>/analysis/runs/<runId>/issues/<issueId>/response
 *   body: { body, base_edit_version }
 *   → 200 { issue_id, run_id, created_at, updated_at, edit_version, answered }
 *   → 409 stale_response { error, reason, current: { edit_version, updated_at } }
 *
 * - GET /api/requirements/<id>/analysis/responses
 *   → 200 { responses: IssueResponseGetResponse[] }  (仅已答复)
 */

import { z } from 'zod'
import { IssueResponseGetResponseSchema, IssueResponsePutResponseSchema } from '@ai-devspace/shared'
import { agentFetch, AgentError } from './agent-client'

export type IssueResponseGet = z.infer<typeof IssueResponseGetResponseSchema>
export type IssueResponsePut = z.infer<typeof IssueResponsePutResponseSchema>

/** 服务端明确告知 base 与 current 不一致的错误(用于 flush 重试) */
export class StaleResponseError extends Error {
  constructor(
    public readonly currentEditVersion: number,
    public readonly currentUpdatedAt: string,
  ) {
    super(
      `StaleResponse: current edit_version=${currentEditVersion}, updated_at=${currentUpdatedAt}`,
    )
    this.name = 'StaleResponseError'
  }
}

/** 服务端明确告知 404 run / issue 不存在 */
export class ResponseTargetNotFoundError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`${code} (HTTP ${status})`)
    this.name = 'ResponseTargetNotFoundError'
  }
}

function responsePath(
  requirementId: string,
  runId: string,
  issueId: string,
): string {
  return `/api/requirements/${encodeURIComponent(requirementId)}/analysis/runs/${encodeURIComponent(runId)}/issues/${encodeURIComponent(issueId)}/response`
}

function responsesListPath(requirementId: string): string {
  return `/api/requirements/${encodeURIComponent(requirementId)}/analysis/responses`
}

/** 读单条 Issue Response。缺失/不存在都返 { ... empty, answered: false }。 */
export async function fetchIssueResponse(
  requirementId: string,
  runId: string,
  issueId: string,
): Promise<IssueResponseGet> {
  const raw = await agentFetch<unknown>(
    responsePath(requirementId, runId, issueId),
    { method: 'GET' },
  )
  return IssueResponseGetResponseSchema.parse(raw)
}

/** 写 Issue Response。base_edit_version 与服务端不一致 → 抛 StaleResponseError */
export async function putIssueResponse(
  requirementId: string,
  runId: string,
  issueId: string,
  body: string,
  baseEditVersion: number,
): Promise<IssueResponsePut> {
  let raw: unknown
  try {
    raw = await agentFetch<IssueResponsePut>(responsePath(requirementId, runId, issueId), {
      method: 'PUT',
      body: JSON.stringify({ body, base_edit_version: baseEditVersion }),
    })
  } catch (err) {
    if (err instanceof AgentError && err.status === 409) {
      const body = err.body as { error?: string; current?: { edit_version?: number; updated_at?: string } } | null
      if (body?.error === 'stale_response' && body.current) {
        throw new StaleResponseError(
          body.current.edit_version ?? 0,
          body.current.updated_at ?? '',
        )
      }
    }
    if (err instanceof AgentError && (err.status === 404)) {
      const code = (err.body as { error?: string } | null)?.error ?? 'not_found'
      throw new ResponseTargetNotFoundError(err.status, code)
    }
    throw err
  }
  return IssueResponsePutResponseSchema.parse(raw)
}

/** 列 Requirement 全部已答复 Issue Response */
export async function fetchIssueResponses(
  requirementId: string,
): Promise<IssueResponseGet[]> {
  const raw = await agentFetch<unknown>(responsesListPath(requirementId), { method: 'GET' })
  const parsed = z.object({ responses: z.array(IssueResponseGetResponseSchema) }).parse(raw)
  return parsed.responses
}