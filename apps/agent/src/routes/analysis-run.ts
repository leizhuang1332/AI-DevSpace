/**
 * Analysis Run REST endpoints(issue 02 · ADR-0021)
 *
 * 端点:
 * - POST  /api/requirements/:id/analysis/start
 *   body: { skill_name }
 *   启动门禁(issue 02 acceptance 2):
 *     - PRD 必须存在且非空
 *     - Skill 必须存在且有效
 *     - 同 Requirement 无运行中 Run(单运行约束)
 *   成功响应(201):Run 元数据(status='running')
 *   失败响应:
 *     - 400 skill_name 缺失 / 不在 available
 *     - 409 prd_not_ready / analysis_run_already_running
 *
 * - GET   /api/requirements/:id/analysis/runs
 *   列 Requirement 所有 Run(按 created_at 倒序)
 *
 * - GET   /api/requirements/:id/analysis/runs/:runId
 *   Run 详情:meta + issues + log
 *
 * SDK query 启动后 fire-and-forget(POST 不等 turn 完成),
 * 异步通过 SSE 把 Issue / Log / 终态推给订阅者(issue 02 acceptance 4)。
 */

import type { FastifyPluginAsync } from 'fastify'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  AnalysisRunStartBodySchema,
  AnalysisRunStartResponseSchema,
  AnalysisRunListResponseSchema,
  AnalysisRunDetailResponseSchema,
  type AnalysisRunStartResponse,
  type AnalysisRunListResponse,
  type AnalysisRunDetailResponse,
} from '@ai-devspace/shared'
import type { SseHub } from '../sse/SseHub.js'
import type { AIProvider } from '../providers/AIProvider.js'
import { AnalysisRunService } from '../analysis-run/AnalysisRunService.js'
import { AnalysisSkillService } from '../analysis-skill/AnalysisSkillService.js'
import { runAnalysisQuery } from '../analysis-run/AnalysisAgentRunner.js'

export interface AnalysisRunRouteDeps {
  hub: SseHub
  provider: AIProvider
  workspaceRoot: string
}

interface StartBody {
  skill_name?: unknown
}

interface DetailParams {
  id: string
  runId: string
}

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

/** SDK 子进程 cwd 解析 —— 显式指向非 git 目录,切断 git-ai.exe trace2 fork。
 *
 * (沿用 `apps/agent/src/routes/analysis.ts` `resolveAnalysisSdkCwd` 同款契约,
 *  便于两个 handler 走同一条 cwd 路径。)
 */
function resolveAnalysisSdkCwd(workspaceRoot: string): string {
  const dir = join(workspaceRoot, '.analysis-cwd')
  mkdirSync(dir, { recursive: true })
  return dir
}

function defaultAgentRoot(): string {
  try {
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

export const analysisRunRoutes: FastifyPluginAsync<AnalysisRunRouteDeps> = async (
  fastify,
  opts,
) => {
  const { hub, provider, workspaceRoot } = opts
  const resolveRoot = (): string =>
    workspaceRoot ?? process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()

  const runService = new AnalysisRunService(resolveRoot())
  const skillService = new AnalysisSkillService(resolveRoot())

  // -------------------------------------------------------------------------
  // POST /api/requirements/:id/analysis/start
  // 启动门禁 + 单运行约束 + 落盘 + 异步 SDK query(issue 02 acceptance 1-5)
  // -------------------------------------------------------------------------
  fastify.post<{
    Params: { id: string }
    Body: StartBody
  }>('/api/requirements/:id/analysis/start', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}

    // 1. 入参 schema 校验(Zod 二次校验)
    const parsedBody = AnalysisRunStartBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(badRequest('skill_name is required and must be non-empty string'))
    }
    const skillName = parsedBody.data.skill_name

    // 2. PRD 必须存在且非空(issue 02 acceptance 2)
    const root = resolveRoot()
    const reqDir = join(root, 'requirements', id)
    const prdPath = join(reqDir, 'requirement.md')
    let prdContent = ''
    try {
      if (existsSync(prdPath)) {
        const text = readFileSync(prdPath, 'utf8')
        // 非空 = trim 后长度 > 0
        if (text.trim().length === 0) {
          return reply.code(409).send({
            error: 'prd_not_ready',
            reason: 'requirement.md exists but is empty; please finish DRAFTING first',
          })
        }
        prdContent = text
      } else {
        return reply.code(409).send({
          error: 'prd_not_ready',
          reason: 'requirement.md does not exist; please finish DRAFTING first',
        })
      }
    } catch (err) {
      fastify.log.error({ err, reqId: id }, 'read prd failed')
      return reply.code(500).send({
        error: 'E_PRD_READ_FAILED',
        message: err instanceof Error ? err.message : String(err),
      })
    }

    // 3. Skill 必须存在且有效(issue 02 acceptance 2)
    const allSkills = skillService.listAllSkills()
    const skillEntry = allSkills.find((s) => s.meta.name === skillName)
    if (!skillEntry) {
      return reply.code(400).send(badRequest(`skill_name '${skillName}' is not in available Analysis Skills`))
    }
    const skillMeta = skillEntry.meta

    // 4. 单运行约束(issue 02 acceptance 3)—— 服务端原子拒绝
    const createResult = await runService.createRun({
      requirementId: id,
      skillName,
    })
    if (!createResult.ok) {
      return reply.code(409).send({
        error: 'analysis_run_already_running',
        reason: 'another Analysis Run is already running for this Requirement',
        running_run: createResult.runningRun,
      })
    }
    const { run, runDir } = createResult

    // 5. publish `analysis_run_created`(issue 02 acceptance 4 · Web 端收到即渲染)
    hub.publish(id, {
      type: 'analysis_run_created',
      reqId: id,
      runId: run.run_id,
      ts: Date.now(),
      skillName: run.skill_name,
      createdAt: run.created_at,
    })

    // 6. 同步 201(issue 02 acceptance 4 · 立即返回 Run 标识 + Skill 名称 + 创建时间 + running)
    const startResponse: AnalysisRunStartResponse = {
      run_id: run.run_id,
      requirement_id: run.requirement_id,
      skill_name: run.skill_name,
      created_at: run.created_at,
      status: 'running',
    }
    const validatedResponse = AnalysisRunStartResponseSchema.parse(startResponse)

    // 7. fire-and-forget 启动 SDK query(POST 不等 turn 完成)
    //    失败时仅 log,不影响 201 返回;Run 状态由 transitionToFailed 兜底
    void (async () => {
      const cwd = resolveAnalysisSdkCwd(root)
      try {
        await runAnalysisQuery({
          workspaceRoot: root,
          provider,
          runService,
          hub,
          skillBody: skillEntry.body,
          skillMeta,
          answeredContext: [],
          scope: {
            requirement_id: id,
            repo_names: [], // issue 04:关联 Repository 列表
            prd_markdown: prdContent,
          },
          cwd,
          requirementId: id,
          runId: run.run_id,
          topic: `analysis-run-${run.run_id}`,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        fastify.log.error(
          { err, reqId: id, runId: run.run_id, runDir },
          'runAnalysisQuery threw',
        )
        // SDK 直接抛(而非返回 ok:false)→ 兜底失败
        const failed = runService.transitionToFailed(id, run.run_id, message)
        if (failed.ok) {
          hub.publish(id, {
            type: 'analysis_run_failed',
            reqId: id,
            runId: run.run_id,
            ts: Date.now(),
            finishedAt: failed.run.finished_at ?? new Date().toISOString(),
            error: message,
            issueCount: failed.run.issue_count,
          })
        }
        await runService.releaseStartupLock(id)
      }
    })()

    return reply.code(201).send(validatedResponse)
  })

  // -------------------------------------------------------------------------
  // GET /api/requirements/:id/analysis/runs —— Run 列表(按 created_at 倒序)
  // -------------------------------------------------------------------------
  fastify.get<{
    Params: { id: string }
  }>('/api/requirements/:id/analysis/runs', async (req, reply) => {
    const { id } = req.params
    const runs = runService.listRuns(id)
    const response: AnalysisRunListResponse = { runs }
    return reply.code(200).send(AnalysisRunListResponseSchema.parse(response))
  })

  // -------------------------------------------------------------------------
  // GET /api/requirements/:id/analysis/runs/:runId —— Run 详情
  // -------------------------------------------------------------------------
  fastify.get<{
    Params: DetailParams
  }>('/api/requirements/:id/analysis/runs/:runId', async (req, reply) => {
    const { id, runId } = req.params
    const meta = runService.readMeta(id, runId)
    if (!meta) {
      return reply.code(404).send({
        error: 'analysis_run_not_found',
        reason: `no Analysis Run '${runId}' for Requirement '${id}'`,
      })
    }
    const issues = runService.readIssues(id, runId)
    const log = runService.readLog(id, runId)
    const response: AnalysisRunDetailResponse = {
      run: meta,
      issues,
      log,
    }
    return reply.code(200).send(AnalysisRunDetailResponseSchema.parse(response))
  })
}