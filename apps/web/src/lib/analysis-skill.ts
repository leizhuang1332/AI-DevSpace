/**
 * Analysis Skill 客户端 API wrapper(issue 01 · ADR-0021)
 *
 * 端点:
 * - `GET  /api/analysis-skills`                      → 列出所有合法 Skill
 * - `GET  /api/requirements/:id/analysis/skill-selection` → 读已选项 + available
 * - `PUT  /api/requirements/:id/analysis/skill-selection` → 写已选项
 *
 * 出参 Zod 二次校验(与 `agent-bootstrap.ts` / `analysis-start.ts` / `repo-attach.ts` 同款)
 * 防后端契约漂移。
 */

import { agentFetch, AgentError } from './agent-client'
import {
  AnalysisSkillListResponseSchema,
  AnalysisSkillSelectionPutBodySchema,
  AnalysisSkillSelectionResponseSchema,
  type AnalysisSkillListResponse,
  type AnalysisSkillSelectionPutBody,
  type AnalysisSkillSelectionResponse,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * 与 `startAnalysis` 同款 super 模板:`<Verb> ${status}: ${body}`
 * `code` 字段由消费方按需区分(本期无特定业务 code,预留给未来)。
 */
export class AnalysisSkillError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly code?: string,
  ) {
    super(
      `AnalysisSkill ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
    this.name = 'AnalysisSkillError'
  }
}

function wrapAgentError(err: unknown): never {
  if (err instanceof AgentError) {
    const code =
      typeof err.body === 'object' &&
      err.body !== null &&
      'error' in err.body &&
      typeof (err.body as { error: unknown }).error === 'string'
        ? (err.body as { error: string }).error
        : undefined
    throw new AnalysisSkillError(err.status, err.body, code)
  }
  throw err
}

// ---------------------------------------------------------------------------
// listAnalysisSkills
// ---------------------------------------------------------------------------

export async function listAnalysisSkills(): Promise<AnalysisSkillListResponse> {
  let raw: unknown
  try {
    raw = await agentFetch<AnalysisSkillListResponse>('/api/analysis-skills')
  } catch (err) {
    wrapAgentError(err)
  }
  return AnalysisSkillListResponseSchema.parse(raw)
}

// ---------------------------------------------------------------------------
// readSelection / writeSelection
// ---------------------------------------------------------------------------

export async function readSelection(
  requirementId: string,
): Promise<AnalysisSkillSelectionResponse> {
  let raw: unknown
  try {
    raw = await agentFetch<AnalysisSkillSelectionResponse>(
      `/api/requirements/${encodeURIComponent(requirementId)}/analysis/skill-selection`,
    )
  } catch (err) {
    wrapAgentError(err)
  }
  return AnalysisSkillSelectionResponseSchema.parse(raw)
}

export async function writeSelection(
  requirementId: string,
  body: AnalysisSkillSelectionPutBody,
): Promise<AnalysisSkillSelectionResponse> {
  // 入参二次校验(在发出前就把关,避免明显错请求 round-trip)
  const parsedBody = AnalysisSkillSelectionPutBodySchema.parse(body)
  let raw: unknown
  try {
    raw = await agentFetch<AnalysisSkillSelectionResponse>(
      `/api/requirements/${encodeURIComponent(requirementId)}/analysis/skill-selection`,
      {
        method: 'PUT',
        body: JSON.stringify(parsedBody),
      },
    )
  } catch (err) {
    wrapAgentError(err)
  }
  return AnalysisSkillSelectionResponseSchema.parse(raw)
}
