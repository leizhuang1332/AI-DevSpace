/**
 * prdSplitRoutes —— PRD 拆解 Run REST endpoints(issue 05 / ADR-0027 D4)
 *
 * 4 条端点:
 *   POST   /api/requirement/:id/board/split-from-prd
 *     body: { granularity, expected_count, use_context[] }
 *     启动门禁:PRD 必须存在 + ≥50 字符;单运行约束(mkdir 锁)
 *     成功 201 { run_id, requirement_id, status:'running', created_at }
 *     fire-and-forget:201 返后 void async 跑 runPrdSplitQuery
 *
 *   GET    /api/requirement/:id/board/split-from-prd/runs
 *     列 Requirement 所有 PRD 拆解 Run(按 created_at 倒序)
 *
 *   GET    /api/requirement/:id/board/split-from-prd/runs/:runId
 *     Run 详情:meta + cards[]
 *
 *   DELETE /api/requirement/:id/board/split-from-prd/runs/:runId
 *     永久删除(物理级联整个 proposals/<runId>/ 目录)
 *
 * 守门(ADR-0023 zero-touch):不动 ClaudeCodeProvider /
 * runAnalysisQuery / createSdkMcpServer / mcpCallCounter。本路由只调
 * `provider.runAnalysisQuery`(底层 SDK query 入口)。
 */

import type { FastifyPluginAsync } from 'fastify'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  PrdSplitRunDetailResponseSchema,
  PrdSplitRunListResponseSchema,
  PrdSplitStartBodySchema,
  PrdSplitStartResponseSchema,
  type PrdSplitRunDetailResponse,
  type PrdSplitRunListResponse,
  type PrdSplitStartResponse,
} from '@ai-devspace/shared'
import type { SseHub } from '../sse/SseHub.js'
import type { AIProvider } from '../providers/AIProvider.js'
import { PrdSplitService } from '../prd-split/PrdSplitService.js'
import {
  assemblePrdSplitSystemPrompt,
  buildPrdSplitUserPrompt,
} from '../prd-split/PrdSplitPromptAssembler.js'
import { runPrdSplitQuery } from '../prd-split/PrdSplitRunner.js'
import { readParentAnalyzingTranscript } from '../services/board/TaskCardTranscript.js'

export interface PrdSplitRouteDeps {
  hub: SseHub
  provider: AIProvider
  workspaceRoot: string
}

function defaultAgentRoot(): string {
  try {
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

/** SDK 子进程 cwd 解析 —— 指向非 git目录,切断 git-ai.exe trace2 fork
 *  (沿用 `analysis-run.ts:73` 同款契约,复用同一 `.analysis-cwd/` 目录)。 */
function resolveAnalysisSdkCwd(workspaceRoot: string): string {
  const dir = join(workspaceRoot, '.analysis-cwd')
  mkdirSync(dir, { recursive: true })
  return dir
}

interface StartBody {
  granularity?: unknown
  expected_count?: unknown
  use_context?: unknown
}

interface DetailParams {
  id: string
  runId: string
}

export const prdSplitRoutes: FastifyPluginAsync<PrdSplitRouteDeps> = async (
  fastify,
  opts,
) => {
  const { hub, provider, workspaceRoot } = opts
  const resolveRoot = (): string =>
    workspaceRoot ?? process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()

  const service = new PrdSplitService({ root: resolveRoot() })

  // -------------------------------------------------------------------------
  // POST /api/requirement/:id/board/split-from-prd
  // -------------------------------------------------------------------------
  fastify.post<{
    Params: { id: string }
    Body: StartBody
  }>('/api/requirement/:id/board/split-from-prd', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}

    // 1. 入参 schema 校验
    const parsedBody = PrdSplitStartBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: 'bad_request',
        reason: parsedBody.error.issues.map((i) => i.message).join('; '),
      })
    }
    const { granularity, expected_count, use_context } = parsedBody.data

    // 2. PRD 必须存在且非空(镜像 analysis-run.ts:118-165)
    const root = resolveRoot()
    const reqDir = join(root, 'requirements', id)
    const prdPath = join(reqDir, 'requirement.md')
    let prdContent = ''
    try {
      if (existsSync(prdPath)) {
        const text = readFileSync(prdPath, 'utf8')
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
      fastify.log.error({ err, reqId: id }, 'prd split: read prd failed')
      return reply.code(500).send({
        error: 'E_PRD_READ_FAILED',
        message: err instanceof Error ? err.message : String(err),
      })
    }

    // PR-5 阈值:PRD ≥ 50 字符才拆解(与 Analysis Run 同一防退化逻辑)
    const PRD_MIN_LENGTH = 50
    if (prdContent.trim().length < PRD_MIN_LENGTH) {
      return reply.code(400).send({
        error: 'empty_prd',
        reason: `PRD 内容过短(< ${PRD_MIN_LENGTH} 字符),无法支撑拆解;请先完成 DRAFTING`,
        min_length: PRD_MIN_LENGTH,
        actual_length: prdContent.trim().length,
      })
    }

    // 3. 读父 analyzing transcript tail(prompt 上下文,ADR-0027 D4 +
    //    ADR-0028 D3 派生思路;Run 跑在父 transcript 内)
    const parentMessages = readParentAnalyzingTranscript(root, id)

    // 4. 装配 systemPrompt + user prompt
    const systemPrompt = assemblePrdSplitSystemPrompt({
      requirement_id: id,
      prd_markdown: prdContent,
      granularity,
      expected_count,
      use_context,
      parent_transcript_messages: parentMessages,
    })
    const userPrompt = buildPrdSplitUserPrompt({ granularity, expected_count })

    // 5. 单运行约束(mkdir 锁)→ createRun 落盘 meta.yaml + 空 cards.yaml
    const createResult = await service.createRun({
      requirementId: id,
      granularity,
      expectedCount: expected_count,
      useContext: use_context,
    })
    if (!createResult.ok) {
      if (createResult.code === 'startup_lock_stale') {
        return reply.code(500).send({
          error: 'startup_lock_stale',
          reason: createResult.reason,
        })
      }
      return reply.code(409).send({
        error: 'prd_split_already_running',
        reason: 'another PRD split Run is already running for this Requirement',
        running_run: createResult.runningRun,
      })
    }
    const { run } = createResult

    // 6. publish prd_split_created(Web 端据此切 loading + 轮询 GET)
    hub.publish(id, {
      type: 'prd_split_created',
      reqId: id,
      runId: run.run_id,
      ts: Date.now(),
      granularity,
      expectedCount: expected_count,
      createdAt: run.created_at,
    })

    // 7. 201 立返(fire-and-forget)
    const startResponse: PrdSplitStartResponse = {
      run_id: run.run_id,
      requirement_id: run.requirement_id,
      status: 'running',
      created_at: run.created_at,
    }
    const validatedResponse = PrdSplitStartResponseSchema.parse(startResponse)

    // 8. fire-and-forget 跑 SDK query(POST 不等 turn 完成)
    //    失败仅 log + transitionToFailed 兜底;不影响 201 返回
    const cwd = resolveAnalysisSdkCwd(root)
    void (async () => {
      try {
        await runPrdSplitQuery({
          provider,
          service,
          hub,
          systemPrompt,
          prompt: userPrompt,
          cwd,
          requirementId: id,
          runId: run.run_id,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        fastify.log.error(
          { err, reqId: id, runId: run.run_id },
          'prd split: runPrdSplitQuery threw',
        )
        const failed = service.transitionToFailed(id, run.run_id, message)
        if (failed.ok) {
          hub.publish(id, {
            type: 'prd_split_failed',
            reqId: id,
            runId: run.run_id,
            ts: Date.now(),
            finishedAt: failed.run.finished_at ?? new Date().toISOString(),
            error: message,
            actualCount: failed.run.actual_count,
          })
        }
        await service.releaseLock(id).catch(() => {})
      }
    })()

    return reply.code(201).send(validatedResponse)
  })

  // -------------------------------------------------------------------------
  // GET /api/requirement/:id/board/split-from-prd/runs —— Run 列表
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/api/requirement/:id/board/split-from-prd/runs',
    async (req, reply) => {
      const { id } = req.params
      const runs = service.listRuns(id)
      const response: PrdSplitRunListResponse = { runs }
      return reply.code(200).send(PrdSplitRunListResponseSchema.parse(response))
    },
  )

  // -------------------------------------------------------------------------
  // GET /api/requirement/:id/board/split-from-prd/runs/:runId —— Run 详情
  // -------------------------------------------------------------------------
  fastify.get<{ Params: DetailParams }>(
    '/api/requirement/:id/board/split-from-prd/runs/:runId',
    async (req, reply) => {
      const { id, runId } = req.params
      const meta = service.readMeta(id, runId)
      if (!meta) {
        return reply.code(404).send({
          error: 'prd_split_run_not_found',
          reason: `no PRD split Run '${runId}' for Requirement '${id}'`,
        })
      }
      const cards = service.readCards(id, runId)
      const response: PrdSplitRunDetailResponse = { run: meta, cards }
      return reply
        .code(200)
        .send(PrdSplitRunDetailResponseSchema.parse(response))
    },
  )

  // -------------------------------------------------------------------------
  // DELETE /api/requirement/:id/board/split-from-prd/runs/:runId —— 永久删除
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: DetailParams }>(
    '/api/requirement/:id/board/split-from-prd/runs/:runId',
    async (req, reply) => {
      const { id, runId } = req.params
      const result = service.deleteRun(id, runId)
      if (!result.ok) {
        if (result.code === 'run_not_found') {
          return reply.code(404).send({
            error: 'prd_split_run_not_found',
            reason: result.reason,
          })
        }
        if (result.code === 'run_still_running') {
          return reply.code(409).send({
            error: 'prd_split_run_still_running',
            reason: result.reason,
            run: result.run,
          })
        }
        return reply.code(500).send({
          error: 'prd_split_delete_failed',
          reason: result.reason,
        })
      }
      hub.publish(id, {
        type: 'prd_split_deleted',
        reqId: id,
        runId,
        ts: Date.now(),
        deletedAt: new Date().toISOString(),
        granularity: result.run.granularity,
        actualCount: result.run.actual_count,
      })
      return reply.code(204).send()
    },
  )
}
