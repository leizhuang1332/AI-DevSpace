/**
 * 创建需求 API wrapper(.scratch/new-requirement-modal/issues/06-web-post-api-requirements-alignment.md)
 *
 * 调 `POST /api/requirements` 给指定 title 创建需求目录 + meta.yaml + requirement.md。
 *
 * 设计:
 * - 入参 schema 二次校验(Zod,即使绕过 NewRequirementModal 也防御)
 * - 响应 schema 二次校验(防后端契约变更)
 * - 错误处理:AgentError → CreateRequirementError,前端按 status 决定 UI 行为
 *   (决策 34 / PRD §9 E6-E9)
 *
 * 调用方:new-requirement-modal.tsx 的 submit
 *
 * ticket 06 之前:web 端用 `Date.now()` mock id 推路由,后端从未被调用,
 * 导致 PRD §7 stage 3-4("Agent 端 POST + 写 meta.yaml + 骨架屏切 banner")
 * 未端到端打通。本 wrapper 闭合这个 gap。
 */

import { z } from 'zod'
import {
  CreateRequirementRequestSchema,
  CreateRequirementResponseSchema,
  type CreateRequirementRequest,
  type CreateRequirementResponse,
} from '@ai-devspace/shared'
import { agentFetch, AgentError } from './agent-client'

export class CreateRequirementError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    /** 已对人类友好的错误码(decision 34 / PRD §9 E_AUTH 等),用于 UI 映射 */
    public readonly code?: string,
  ) {
    super(
      `CreateRequirement ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    )
    this.name = 'CreateRequirementError'
  }
}

/** 入参类型(由 shared re-export,这里再 alias 便于 web 端 import 一处) */
export type CreateRequirementPayload = CreateRequirementRequest

/**
 * 调后端 POST /api/requirements。
 * - 入参 / 出参 schema 双重校验
 * - 非 2xx 抛 CreateRequirementError(带 status + body)
 * - 网络错 / 反序列化错 抛原始 Error / ZodError
 *
 * 错误码语义(对齐 PRD §9):
 * - 400 E_INVALID_TITLE  → 前端 inline 红字提示,modal 不关
 * - 401 E_AUTH           → 跳设置页(决策 34),modal 关
 * - 500 E_ID_COLLISION   → modal 不关,提示用户重试
 * - 507 E_DISK_FULL      → modal 关,DRAFTING banner 显示(决策 31 SSE 接管)
 * - 网络错 / 其他        → modal 不关,inline 红字 + 重试按钮
 */
export async function createRequirement(
  payload: CreateRequirementPayload,
  opts?: { signal?: AbortSignal },
): Promise<CreateRequirementResponse> {
  // 1. 入参校验(shared schema 兜底:trim + 长度 1-50)
  const parsedReq = CreateRequirementRequestSchema.parse(payload)

  let raw: unknown
  try {
    raw = await agentFetch<CreateRequirementResponse>('/api/requirements', {
      method: 'POST',
      body: JSON.stringify(parsedReq),
      signal: opts?.signal,
    })
  } catch (err) {
    if (err instanceof AgentError) {
      // 从 body 提取 code 字段(后端 AgentError body 形如 { error, message })
      const code =
        typeof err.body === 'object' &&
        err.body !== null &&
        'error' in err.body &&
        typeof (err.body as { error: unknown }).error === 'string'
          ? (err.body as { error: string }).error
          : undefined
      throw new CreateRequirementError(err.status, err.body, code)
    }
    throw err
  }

  // 2. 出参校验(防后端契约变更)
  return CreateRequirementResponseSchema.parse(raw)
}

// ============================================================================
// Re-export Zod schema + 类型 —— 让 web 端不必再 import @ai-devspace/shared
// ============================================================================

export { CreateRequirementRequestSchema, CreateRequirementResponseSchema }
export type { CreateRequirementRequest, CreateRequirementResponse }

/** Zod 版本断言 schema(简单 typeguard,避免 web 端 import z 重复声明) */
export function isCreateRequirementError(err: unknown): err is CreateRequirementError {
  return err instanceof CreateRequirementError
}

/** safeParse 兜底 —— 转为带 message 的 Error */
export function safeParseCreateRequirementResponse(raw: unknown): {
  ok: boolean
  data?: CreateRequirementResponse
  error?: z.ZodError
} {
  const r = CreateRequirementResponseSchema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  return { ok: false, error: r.error }
}