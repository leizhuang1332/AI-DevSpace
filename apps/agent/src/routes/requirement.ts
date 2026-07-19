import { createReadStream } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import {
  AttachReposRequestSchema,
  CreateRequirementRequestSchema,
  ParseUploadResponseSchema,
  REASON_TO_HTTP_STATUS,
  UploadPayloadSchema,
  UploadReplaceResponseSchema,
  validateBranchName,
  type AttachReposResponse,
  type CreateRequirementResponse,
  type RequirementErrorCodeT,
} from '@ai-devspace/shared'
import {
  RequirementServiceError,
  RequirementIdCollisionError,
  type RequirementService,
} from '../services/RequirementService.js'
import type { SseHub } from '../sse/SseHub.js'

function notImplemented(feature: string, issue: string): {
  error: 'not_implemented'
  feature: string
  message: string
  issue: string
} {
  return {
    error: 'not_implemented',
    feature,
    message: `本期骨架仅占位；真实实装见 issue ${issue}`,
    issue,
  }
}

/**
 * requirementRoutes —— Requirement 工作台相关 REST endpoints
 *
 * 历史背景(决策 / issue tracker):
 * - issue 04 ticket(POST /api/requirements 文件落盘):本期实装
 *   - slug 派生(PRD §8.3) + ID 自增 + 冲突重试 3 次
 *   - mkdir 0700 + 写 meta.yaml + requirement.md
 *   - 鉴权由 authPlugin 全局 onRequest hook 拦截 401/403
 *   - 失败路径通过 SseHub 推 `requirement_created{ok:false}` 让 DRAFTING
 *     切红色 banner(决策 31 + PRD §9 E6-E9)
 * - issue 02 ticket(POST /api/requirement/:id/repos):上一 slice 实装
 * - issue 05 ticket 07a 实装 GET /api/requirements(由 filesystem 产物目录派生
 *   status / progress / repos,按 updatedAt 倒序),并对 POST 双推全局 SSE 通道
 *   `'requirements'`(决策 4 · ADR-0014)
 *
 * 后续 slice 替换剩余 3 个 501 stub(逐 ticket 推进)。
 */
export interface RequirementRoutesDeps {
  /**
   * 实装 requirement 业务的服务。
   * - 未注入时新路由返回 503 `service_not_ready`(兼容旧测试)
   * - 注入但缺少 repo pool 时,route 仍会返回 per-repo `E_REPO_NOT_FOUND`
   */
  requirementService?: RequirementService
  /** SSE hub —— 创建成功 / 失败时推 `requirement_created` 事件(决策 31) */
  sseHub?: SseHub
}

export async function requirementRoutes(
  app: FastifyInstance,
  deps: RequirementRoutesDeps = {},
): Promise<void> {
  // ============================================================================
  // 3 个 501 stub(后续 ticket 逐个替换;ticket 07a 已实装 GET /api/requirements)
  // ============================================================================

  app.get('/api/requirements', async (_req, reply) => {
    const { requirementService: service } = deps
    if (!service) {
      return reply.code(503).send({ error: 'service_not_ready' })
    }
    try {
      const requirements = service.listRequirements()
      return reply.code(200).send({ requirements })
    } catch (err) {
      _req.log.error({ err }, 'listRequirements failed')
      return reply.code(500).send({ error: 'E_INTERNAL', message: 'list failed' })
    }
  })

  app.get<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    const { requirementService: service } = deps
    if (!service) {
      return reply.code(503).send({ error: 'service_not_ready' })
    }
    const detail = service.get(req.params.id)
    if (!detail) {
      return reply.code(404).send({
        error: 'E_REQUIREMENT_NOT_FOUND',
        requirementId: req.params.id,
      })
    }
    return reply.code(200).send(detail)
  })

  app.patch<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.update', '05'))
  })

  app.post<{ Params: { id: string } }>(
    '/api/requirement/:id/skill',
    async (req, reply) => {
      return reply.code(501).send(notImplemented('requirement.run_skill', '08'))
    },
  )

  // ============================================================================
  // ticket 02 —— GET /api/requirement/:id/assets/:filename (ADR-0015 D5)
  // ============================================================================

  app.get<{ Params: { id: string; filename: string } }>(
    '/api/requirement/:id/assets/:filename',
    async (req, reply) => {
      const { requirementService: service } = deps
      if (!service) {
        return reply.code(503).send({ error: 'service_not_ready' })
      }
      const { id, filename } = req.params

      // 1. 路径安全(也防 NUL / '..' / '\\');resolveAssetFile 已把不合法路径返回 null。
      const resolved = service.resolveAssetFile(id, filename)
      if (!resolved) {
        // 不区分"不存在"与"路径穿越"——防 oracle;统一 404
        req.log.warn({ reqId: id, filename }, 'asset not found or traversal attempt')
        return reply.code(404).send({ error: 'E_ASSET_NOT_FOUND' })
      }

      // 2. 设置 Content-Type(mime 由 extensionToImageMime 派生) + Content-Length
      reply
        .header('Content-Type', resolved.mime)
        .header('Content-Length', String(resolved.size))
        // 资源是图片,允许任何 web origin 缓存,与决策无关
        .header('Cache-Control', 'private, max-age=60')
      return reply.send(createReadStream(resolved.absPath))
    },
  )

  // ============================================================================
  // POST /api/requirements —— issue 04 ticket(文件落盘 + SSE 推送)
  // ============================================================================

  app.post<{ Body: unknown }>('/api/requirements', async (req, reply) => {
    const { requirementService: service, sseHub } = deps

    if (!service) {
      return reply.code(503).send({ error: 'service_not_ready' })
    }

    // 1. body schema 校验(title trim + 长度 1-50, ticket 03 可选 prdMarkdown + images)
    const parsed = CreateRequirementRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'E_INVALID_TITLE',
        details: parsed.error.issues,
      })
    }
    const { title, prdMarkdown, images } = parsed.data

    // 2. 调 service 落盘(ticket 03:有 prdMarkdown / images 时落 assets/ + 写盘)
    let result: CreateRequirementResponse
    try {
      const created = service.createRequirement(
        title,
        prdMarkdown,
        images ?? [],
      )
      result = { id: created.id, title: created.title, createdAt: created.createdAt }
    } catch (err) {
      // 错误码映射:RequirementServiceError.code → 顶层 HTTP code + 推送失败 SSE
      const code: RequirementErrorCodeT =
        err instanceof RequirementIdCollisionError
          ? 'E_ID_COLLISION'
          : err instanceof RequirementServiceError
            ? err.code
            : 'E_INTERNAL'
      const message = err instanceof Error ? err.message : 'unknown error'
      req.log.error({ err, code }, 'createRequirement failed')
      // SSE 推送失败事件(用临时 id 占位 channel,无订阅者 → no-op)
      const tempId = `req-pending-${Date.now()}`
      sseHub?.publish(tempId, {
        type: 'requirement_created',
        reqId: tempId,
        ok: false,
        ts: Date.now(),
        code,
        message,
      })
      const httpStatus = code === 'E_DISK_FULL' ? 507 : 500
      return reply.code(httpStatus).send({ error: code, message })
    }

    // 3. SSE 推送成功事件 —— 推送到新建 id 的通道
    sseHub?.publish(result.id, {
      type: 'requirement_created',
      reqId: result.id,
      ok: true,
      ts: Date.now(),
      title: result.title,
      createdAt: result.createdAt,
    })

    // 3b. 全局通道(决策 4 · ticket 07a):通知所有 dashboard / list 订阅者,
    //     channelId = 'requirements'(固定字符串,SseHub 不区分语义,key 是任意字符串)。
    //     无订阅者时 publish 是 no-op(SseHub.ts:104),不报错。
    sseHub?.publish('requirements', {
      type: 'requirement_created',
      reqId: result.id,
      ok: true,
      ts: Date.now(),
      title: result.title,
      createdAt: result.createdAt,
    })

    // 4. 返回 201 + body
    return reply.code(201).send(result)
  })

  // ============================================================================
  // POST /api/requirement/:id/repos —— issue 02 ticket(worktree 真实创建)
  // ============================================================================

  app.post<{
    Params: { id: string }
    Body: unknown
  }>('/api/requirement/:id/repos', async (req, reply) => {
    const { id } = req.params
    const { requirementService: service } = deps

    if (!service) {
      return reply.code(503).send({ error: 'service_not_ready' })
    }

    // 1. body schema 校验(repoIds 非空 + 长度上限;branchName 长度 ≤ 100)
    const parsed = AttachReposRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_body',
        details: parsed.error.issues,
      })
    }
    const { repoIds, branchName } = parsed.data

    // 2. 分支名校验(strict 模式:原始输入含任何非法字符即 reject,
    //    ticket 02 验收 #11"Agent 端再校验一次(前端已过滤,后端兜底)")
    const branchCheck = validateBranchName(branchName, { strict: true })
    if (!branchCheck.ok) {
      return reply.code(400).send({
        error: 'E_INVALID_BRANCH_NAME',
        message: branchCheck.error ?? 'invalid branch name',
      })
    }
    const sanitizedBranch = branchCheck.sanitized

    // 3. 校验 req 目录是否存在
    if (!(await service.checkRequirementExists(id))) {
      return reply.code(404).send({
        error: 'E_REQUIREMENT_NOT_FOUND',
        requirementId: id,
      })
    }

    // 4. 逐 repo 创建,收集 results(部分失败不中断)
    const results = await service.attachRepos(id, repoIds, sanitizedBranch)
    const succeeded = results.filter((r) => r.ok).length
    const failed = results.length - succeeded

    const body: AttachReposResponse = {
      requirementId: id,
      branchName: sanitizedBranch,
      succeeded,
      failed,
      results,
    }
    return reply.code(200).send(body)
  })

  // ============================================================================
  // ticket 03 (ADR-0015 D3 / D8) —— 双入口上传管道
  //
  // - POST /api/uploads/parse —— Dialog 预填
  //   闸门 + parseUpload(不写盘),返回 markdown 让前端填进 textarea。
  //   真正的写盘等到用户点"创建"时由 POST /api/requirements 接管(ticket 04)。
  //
  // - POST /api/requirement/:id/upload-replace —— DRAFTING 覆盖(W4)
  //   闸门 + parseUpload + landAssets + replaceDataUriWithAssetPath + 覆盖 requirement.md。
  //   不弹 modal / 不输入确认 / 不写历史(ADR-0015 D8 W4)。
  // ============================================================================

  /**
   * 把 service 返回的 `{ok:false, reason, message?}` 映射到 HTTP 状态码 + 错误体。
   * 直接读 `shared.REASON_TO_HTTP_STATUS`,不要在 route 层另写一份映射。
   */
  function uploadFailStatus(
    reason: Exclude<keyof typeof REASON_TO_HTTP_STATUS, never>,
  ): { code: string; status: number } {
    return REASON_TO_HTTP_STATUS[reason]
  }

  app.post<{ Body: unknown }>('/api/uploads/parse', async (req, reply) => {
    const { requirementService: service } = deps
    if (!service) {
      return reply.code(503).send({ error: 'service_not_ready' })
    }
    const parsed = UploadPayloadSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'E_INVALID_UPLOAD_PAYLOAD',
        details: parsed.error.issues,
      })
    }
    const { filename, mime, contentBase64 } = parsed.data
    const buffer = Buffer.from(contentBase64, 'base64')

    const result = await service.parseForDialog(buffer, filename, mime)
    if (!result.ok) {
      const { code, status } = uploadFailStatus(result.reason)
      return reply.code(status).send({
        error: code,
        reason: result.reason,
        message: result.message ?? null,
      })
    }
    const body = ParseUploadResponseSchema.parse({
      markdown: result.markdown,
      images: result.images,
    })
    return reply.code(200).send(body)
  })

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/requirement/:id/upload-replace',
    async (req, reply) => {
      const { requirementService: service } = deps
      if (!service) {
        return reply.code(503).send({ error: 'service_not_ready' })
      }
      const parsed = UploadPayloadSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'E_INVALID_UPLOAD_PAYLOAD',
          details: parsed.error.issues,
        })
      }
      const { filename, mime, contentBase64 } = parsed.data
      const buffer = Buffer.from(contentBase64, 'base64')

      try {
        const result = await service.uploadAndReplace(
          req.params.id,
          buffer,
          filename,
          mime,
        )
        if (!result.ok) {
          const { code, status } = uploadFailStatus(result.reason)
          return reply.code(status).send({
            error: code,
            reason: result.reason,
            message: result.message ?? null,
          })
        }
        const body = UploadReplaceResponseSchema.parse({
          markdown: result.markdown,
          assets: result.assets,
        })
        return reply.code(200).send(body)
      } catch (err) {
        // landAssets / writeFile 抛错(磁盘满 / IO 错) → 500,前端顶部红条
        req.log.error(
          { err, reqId: req.params.id },
          'uploadAndReplace 写盘失败',
        )
        return reply.code(500).send({
          error: 'E_INTERNAL',
          message: err instanceof Error ? err.message : 'unknown error',
        })
      }
    },
  )
}
