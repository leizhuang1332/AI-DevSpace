/**
 * Analysis Skill 路由(issue 01 · ADR-0021)
 *
 * 端点:
 * - GET  /api/analysis-skills
 *   列出所有合法 Analysis Skill(Workspace 独立集合,不混入全局 / 个人 / 项目 Skill)
 *
 * - GET  /api/requirements/:id/analysis/skill-selection
 *   返 `{ selected_skill_name, available_skills }`;已记住名不存在时由
 *   service 兜底回退到首项(已按 name 字典序排序)
 *
 * - PUT  /api/requirements/:id/analysis/skill-selection
 *   body: `{ skill_name }`,校验该名仍在 available_skills 中 → 写盘
 *
 * 设计要点(沿用 repos 端点模式,decision 74 / 78):
 * - 实时 readdir,无缓存
 * - 目录不存在 / ENOENT → 返空(200,非 404);IO 错 → 500
 * - 出参 Zod parse 二次校验,防契约漂移
 * - PUT 写盘失败 → 500(由调用方重试,不做自动回滚)
 */

import type { FastifyInstance } from 'fastify'
import {
  AnalysisSkillListResponseSchema,
  AnalysisSkillSelectionPutBodySchema,
  AnalysisSkillSelectionResponseSchema,
  type AnalysisSkillListResponse,
  type AnalysisSkillSelectionResponse,
} from '@ai-devspace/shared'
import { AnalysisSkillService } from '../analysis-skill/AnalysisSkillService.js'

export interface AnalysisSkillRouteDeps {
  workspaceRoot: string
}

interface SelectionPutBody {
  skill_name?: unknown
}

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

export async function analysisSkillRoutes(
  app: FastifyInstance,
  deps: AnalysisSkillRouteDeps,
): Promise<void> {
  const service = new AnalysisSkillService(deps.workspaceRoot)

  // -------------------------------------------------------------------------
  // GET /api/analysis-skills —— 列出所有合法 Analysis Skill
  // -------------------------------------------------------------------------
  app.get('/api/analysis-skills', async (req, reply) => {
    let skills
    try {
      skills = service.toMetaList(service.listAllSkills())
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        const body: AnalysisSkillListResponse = { skills: [] }
        return reply.code(200).send(AnalysisSkillListResponseSchema.parse(body))
      }
      req.log.error(
        { err, dir: service.skillsDir },
        'read analysis skills failed',
      )
      return reply.code(500).send({
        error: 'E_ANALYSIS_SKILLS_READ_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
    const body: AnalysisSkillListResponse = { skills }
    return reply.code(200).send(AnalysisSkillListResponseSchema.parse(body))
  })

  // -------------------------------------------------------------------------
  // GET /api/requirements/:id/analysis/skill-selection
  //   返 { selected_skill_name, available_skills }
  //   已记住名不存在 → 回退到首项(空集合则 selected_skill_name = '')
  // -------------------------------------------------------------------------
  app.get<{
    Params: { id: string }
  }>('/api/requirements/:id/analysis/skill-selection', async (req, reply) => {
    const { id } = req.params
    let available: ReturnType<typeof service.toMetaList>
    try {
      available = service.toMetaList(service.listAllSkills())
    } catch (err) {
      req.log.error({ err, reqId: id }, 'read analysis skills failed')
      return reply.code(500).send({
        error: 'E_ANALYSIS_SKILLS_READ_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
    const resolved = service.resolveSelection(id, available)
    const body: AnalysisSkillSelectionResponse = {
      selected_skill_name: resolved.selectedSkillName,
      available_skills: available,
    }
    return reply
      .code(200)
      .send(AnalysisSkillSelectionResponseSchema.parse(body))
  })

  // -------------------------------------------------------------------------
  // PUT /api/requirements/:id/analysis/skill-selection
  //   body: { skill_name }
  //   校验 skill_name 仍在 available_skills → 写盘 200,否则 400
  // -------------------------------------------------------------------------
  app.put<{
    Params: { id: string }
    Body: SelectionPutBody
  }>('/api/requirements/:id/analysis/skill-selection', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}
    // 1. 入参 schema 校验(Zod 二次校验)
    const parsedBody = AnalysisSkillSelectionPutBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(badRequest('skill_name is required and must be non-empty string'))
    }
    const requested = parsedBody.data.skill_name
    // 2. 校验 skill_name 仍在 available_skills(避免选中非法 Skill)
    let available: ReturnType<typeof service.toMetaList>
    try {
      available = service.toMetaList(service.listAllSkills())
    } catch (err) {
      req.log.error({ err, reqId: id }, 'read analysis skills failed')
      return reply.code(500).send({
        error: 'E_ANALYSIS_SKILLS_READ_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
    if (!available.some((s) => s.name === requested)) {
      return reply
        .code(400)
        .send(
          badRequest(
            `skill_name '${requested}' is not in available Analysis Skills`,
          ),
        )
    }
    // 3. 写盘
    try {
      service.writeSelection(id, requested)
    } catch (err) {
      req.log.error(
        { err, reqId: id, skillName: requested },
        'write analysis skill selection failed',
      )
      return reply.code(500).send({
        error: 'E_ANALYSIS_SKILL_SELECTION_WRITE_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
    // 4. 返新选择 + 当前可用列表
    const responseBody: AnalysisSkillSelectionResponse = {
      selected_skill_name: requested,
      available_skills: available,
    }
    return reply
      .code(200)
      .send(AnalysisSkillSelectionResponseSchema.parse(responseBody))
  })
}
