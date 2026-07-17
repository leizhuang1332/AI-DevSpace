/**
 * 列表需求 API wrapper(ticket 07b)
 *
 * 调 `GET /api/requirements` 拉全量需求摘要(后端按 updatedAt 倒序)。
 *
 * 设计:
 * - 入参:无(空 query)
 * - 出参:RequirementListResponseSchema 二次校验(防后端契约漂移)
 * - 错误:ListRequirementsError extends Error { status, body, code? }
 *   - 401 E_AUTH:跳设置页(沿用 createRequirement 401 模式)
 *   - 503 service_not_ready:agent 未就绪
 *   - 其他:throw err
 *
 * 调用方:
 * - RSC `(workspace)/layout.tsx`(拿 tabs 传 StatusBar)
 * - RSC `(workspace)/page.tsx`(拿 ongoing 过滤后渲染)
 * - RSC `(workspace)/requirements/page.tsx`(拿全量列表)
 *
 * 7b 后端已就绪(07a 实施完成);本文件不写 server fetch,只写 client fetch
 * (RSC 用 server-side fetch 单独处理,见 `requirement-list.server.ts`)。
 */

import {
  RequirementListResponseSchema,
  type RequirementSummary,
  type RequirementListResponse,
} from '@ai-devspace/shared'
import { agentFetch, AgentError } from './agent-client'

export class ListRequirementsError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly code?: string,
  ) {
    super(
      `ListRequirements ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
    this.name = 'ListRequirementsError'
  }
}

/** 客户端 fetch — 调 `GET /api/requirements` 拿列表 */
export async function listRequirements(opts?: {
  signal?: AbortSignal
}): Promise<RequirementSummary[]> {
  let raw: RequirementListResponse
  try {
    raw = await agentFetch<RequirementListResponse>('/api/requirements', {
      method: 'GET',
      signal: opts?.signal,
    })
  } catch (err) {
    if (err instanceof AgentError) {
      const code =
        typeof err.body === 'object' &&
        err.body !== null &&
        'error' in err.body &&
        typeof (err.body as { error: unknown }).error === 'string'
          ? (err.body as { error: string }).error
          : undefined
      throw new ListRequirementsError(err.status, err.body, code)
    }
    throw err
  }
  // 出参二次校验(防后端契约变更)
  const parsed = RequirementListResponseSchema.parse(raw)
  return parsed.requirements
}