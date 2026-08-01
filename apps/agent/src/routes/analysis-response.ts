/**
 * Issue Response REST endpoints(issue 04 · ADR-0021)
 *
 * 端点:
 * - GET   /api/requirements/:id/analysis/responses
 *   列 Requirement 所有未删除历史 Run 的 Issue Response;
 *   未答复 Issue 不进入(issue 04 验收 11)。
 *
 * - GET   /api/requirements/:id/analysis/runs/:runId/issues/:issueId/response
 *   单 Issue Response 读取(便于历史切换时回填编辑器)。
 *   缺失 → 返 200 with body='' + edit_version=0(便于前端无须区分"未填"和"创建失败")。
 *
 * - PUT   /api/requirements/:id/analysis/runs/:runId/issues/:issueId/response
 *   body: { body, base_edit_version }
 *   200:写入成功 + 新 edit_version
 *   409 stale_response:base_edit_version 与服务端当前不一致 → 客户端重新提交
 *   400 bad_request:body 不是字符串 / base_edit_version 不是非负整数
 *   404 run_not_found / issue_not_found
 *
 * 决策要点(issue 04 验收):
 * - 任意未删除历史 Run 的 Issue 都可新增或编辑 Response(验收 2)
 * - 自动保存采用单调编辑版本,较晚返回的旧请求不会覆盖更新正文(验收 7)
 * - 启动分析前的服务端装配走 start 端点的上下文预检,GET/PUT 不参与
 */

import type { FastifyPluginAsync } from 'fastify'
import {
  IssueResponseGetResponseSchema,
  IssueResponsePutBodySchema,
  IssueResponsePutResponseSchema,
  IssueResponsesListResponseSchema,
} from '@ai-devspace/shared'
import type { AnalysisRunService } from '../analysis-run/AnalysisRunService.js'

export interface AnalysisResponseRouteDeps {
  workspaceRoot: string
  runService: AnalysisRunService
}

interface RunIssueParams {
  id: string
  runId: string
  issueId: string
}

interface ReqParams {
  id: string
}

export const analysisResponseRoutes: FastifyPluginAsync<AnalysisResponseRouteDeps> = async (
  fastify,
  opts,
) => {
  const { runService } = opts

  // -------------------------------------------------------------------------
  // GET /api/requirements/:id/analysis/responses —— 列 Requirement 全部已答复
  // -------------------------------------------------------------------------
  fastify.get<{ Params: ReqParams }>(
    '/api/requirements/:id/analysis/responses',
    async (req, reply) => {
      const { id } = req.params
      const responses = runService.listResponses(id)
      const body = IssueResponsesListResponseSchema.parse({ responses })
      return reply.code(200).send(body)
    },
  )

  // -------------------------------------------------------------------------
  // GET /api/requirements/:id/analysis/runs/:runId/issues/:issueId/response
  // 单 Issue Response 读取(便于历史切换时回填编辑器)
  // -------------------------------------------------------------------------
  fastify.get<{ Params: RunIssueParams }>(
    '/api/requirements/:id/analysis/runs/:runId/issues/:issueId/response',
    async (req, reply) => {
      const { id, runId, issueId } = req.params
      const read = runService.readResponse(id, runId, issueId)
      if (!read.ok) {
        return reply.code(500).send({
          ok: false,
          error: read.code,
          reason: read.reason,
        })
      }
      // 不存在 → 返 200 with 空字符串 + edit_version=0(便于前端无须特判"未填")
      const response = read.response ?? {
        issue_id: issueId,
        run_id: runId,
        body: '',
        created_at: '',
        updated_at: '',
        edit_version: 0,
        answered: false,
      }
      const body = IssueResponseGetResponseSchema.parse(response)
      return reply.code(200).send(body)
    },
  )

  // -------------------------------------------------------------------------
  // PUT /api/requirements/:id/analysis/runs/:runId/issues/:issueId/response
  // 自动保存的写入端点;base_edit_version 校验失败 → 409 stale_response
  // -------------------------------------------------------------------------
  fastify.put<{ Params: RunIssueParams }>(
    '/api/requirements/:id/analysis/runs/:runId/issues/:issueId/response',
    async (req, reply) => {
      const { id, runId, issueId } = req.params
      const rawBody = (req.body ?? {}) as Record<string, unknown>
      const parsed = IssueResponsePutBodySchema.safeParse(rawBody)
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: 'bad_request',
          reason: parsed.error.issues
            .map((it) => `${it.path.join('.')}: ${it.message}`)
            .join('; '),
        })
      }

      const result = runService.writeResponse(
        id,
        runId,
        issueId,
        parsed.data.body,
        parsed.data.base_edit_version,
      )
      if (!result.ok) {
        if (result.code === 'run_not_found') {
          return reply.code(404).send({
            ok: false,
            error: 'analysis_run_not_found',
            reason: result.reason,
          })
        }
        if (result.code === 'issue_not_found') {
          return reply.code(404).send({
            ok: false,
            error: 'analysis_issue_not_found',
            reason: result.reason,
          })
        }
        if (result.code === 'stale_response') {
          return reply.code(409).send({
            ok: false,
            error: 'stale_response',
            reason: result.reason,
            current: result.current,
          })
        }
        if (result.code === 'response_corrupt') {
          return reply.code(500).send({
            ok: false,
            error: 'response_corrupt',
            reason: result.reason,
          })
        }
      }
      if (!result.ok) {
        return reply.code(500).send({
          ok: false,
          error: 'unknown',
        })
      }
      const body = IssueResponsePutResponseSchema.parse({
        issue_id: issueId,
        run_id: runId,
        ...result.result,
      })
      return reply.code(200).send(body)
    },
  )
}