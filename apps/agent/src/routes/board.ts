/**
 * boardRoutes —— board section REST endpoints(issue 03 / ADR-0027)
 *
 * 当前切片实装 1 条:
 *   PATCH /api/requirement/:id/board/cards/:cardId/status
 *
 * 走 StatusConstraintGuard(ADR-0025 D2 + D5):
 * - 父 status 处于关键值(implementing / submitting / done)时,模拟子卡切到
 *   新 status 后跑 Guard;若有冲突 + `override=false` → 返回
 *   `{ ok: false, conflicts: [...] }` 让 web 弹 Modal(ADR-0025 D2 选项 A/B/C)。
 * - 冲突 + `override=true` → 调 OverrideLog 写 audit,继续落盘。
 * - 不冲突 → 直接落盘。
 *
 * 反向不约束(ADR-0025 D3):本路由**不**改父 Requirement.status;
 * 即使子卡全部 done,父 status 也不自动切 done,只通过 SSE / UI 提示。
 *
 * 设计要点:
 * - 父 status 由 RequirementService 派生(方案 β · ADR-0014);不引入新派生。
 * - 不调 Provider / Run(issue 03 ticket 守门保留)。
 * - 路由层保持薄壳:参数校验 + Guard + store + override log,业务逻辑全部在 service。
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { TaskCardStatusSchema } from '@ai-devspace/shared'
import { OverrideLog } from '../services/board/OverrideLog.js'
import { checkStatusConstraint } from '../services/board/StatusConstraintGuard.js'
import {
  TaskCardStore,
  TaskCardStoreError,
} from '../services/board/TaskCardStore.js'
import type { RequirementService } from '../services/RequirementService.js'

// ---------------------------------------------------------------------------
// 入参 schema
// ---------------------------------------------------------------------------

const PatchCardStatusBodySchema = z.object({
  status: TaskCardStatusSchema,
  /**
   * 用户在 Modal 里选"强制切换"时传 true(ADR-0025 D2 选项 A)。
   * 默认 false:有冲突 → 立即返回 conflicts,不写盘,不写 override log。
   */
  override: z.boolean().optional().default(false),
})

// ---------------------------------------------------------------------------
// 路由工厂
// ---------------------------------------------------------------------------

export interface BoardRoutesDeps {
  taskCardStore: TaskCardStore
  overrideLog: OverrideLog
  /**
   * RequirementService 用于派生父 Requirement.status(ADR-0014 方案 β)。
   * 未注入时该 endpoint 返回 503,与现有 requirementRoutes 风格一致。
   */
  requirementService?: RequirementService
}

export async function boardRoutes(
  app: FastifyInstance,
  deps: BoardRoutesDeps,
): Promise<void> {
  app.patch<{ Params: { id: string; cardId: string }; Body: unknown }>(
    '/api/requirement/:id/board/cards/:cardId/status',
    async (req, reply) => {
      const { taskCardStore, overrideLog, requirementService } = deps
      if (!requirementService) {
        return reply.code(503).send({ error: 'service_not_ready' })
      }

      // 1. body 校验
      const parsed = PatchCardStatusBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'E_INVALID_BODY',
          details: parsed.error.issues,
        })
      }
      const { status: newStatus, override } = parsed.data

      // 2. 卡存在性 / 读现状
      let current
      try {
        current = taskCardStore.get(req.params.id, req.params.cardId)
      } catch (err) {
        req.log.error(
          { err, reqId: req.params.id, cardId: req.params.cardId },
          'board PATCH status: store.get failed',
        )
        return reply.code(500).send({
          error: 'E_INTERNAL',
          message: err instanceof Error ? err.message : 'unknown',
        })
      }
      if (!current) {
        return reply.code(404).send({
          error: 'E_CARD_NOT_FOUND',
          cardId: req.params.cardId,
        })
      }
      if (current.is_archived) {
        // 软删后不该被改 status — 与 store.updateStatus 语义一致
        return reply.code(404).send({
          error: 'E_CARD_NOT_FOUND',
          cardId: req.params.cardId,
        })
      }

      // 3. 父 status 派生(ADR-0014 方案 β)
      // 走 `listRequirements` 拿当前 req 的派生 status(已有公开方法,
      // 避免新加 `deriveStatusForGuard` 单独接口)。
      // 注意:`listRequirements` 是文件系统派生 —— 与 meta.yaml 独立;
      //   若父 status 通过 `deriveStatus` 派生过(从 reqDir 物理结构读),
      //   与它一致即可,无需再二次解析。
      const reqSummary = requirementService
        .listRequirements()
        .find((r) => r.id === req.params.id)
      if (!reqSummary) {
        return reply.code(404).send({
          error: 'E_REQUIREMENT_NOT_FOUND',
          requirementId: req.params.id,
        })
      }
      const parentStatus = reqSummary.status

      // 4. 跑 Guard(模拟本卡切到新 status,其他不变)
      const cards = taskCardStore.list(req.params.id)
      const guardResult = checkStatusConstraint({
        parentTargetStatus: parentStatus,
        cards,
        simulatedChange: { cardId: current.id, newStatus },
      })

      // 5. 冲突 + 不 override → 返回 conflicts 给 web 弹 Modal
      if (!guardResult.ok && !override) {
        return reply.code(200).send({
          ok: false,
          conflicts: guardResult.conflicts,
          parent_status: parentStatus,
        })
      }

      // 6. 落盘:store.updateStatus 维护 updated_at / completed_at
      //    注:override log 在落盘**成功后**再 append(spec review 修正 ——
      //    之前先写 log 再落盘会导致 audit 与真实状态分裂。)
      let updated
      try {
        updated = taskCardStore.updateStatus(
          req.params.id,
          current.id,
          newStatus,
        )
      } catch (err) {
        if (err instanceof TaskCardStoreError) {
          if (err.code === 'E_CARD_NOT_FOUND') {
            return reply.code(404).send({
              error: 'E_CARD_NOT_FOUND',
              cardId: req.params.cardId,
            })
          }
        }
        req.log.error(
          { err, reqId: req.params.id, cardId: req.params.cardId },
          'board PATCH status: store.updateStatus failed',
        )
        return reply.code(500).send({
          error: 'E_INTERNAL',
          message: err instanceof Error ? err.message : 'unknown',
        })
      }

      // 7. 落盘成功后才写 override log(若用户选了强制切换)
      if (!guardResult.ok && override) {
        try {
          overrideLog.appendFromConflict(req.params.id, {
            kind: 'child_status_force_apply',
            parentStatus,
            conflicts: guardResult.conflicts,
          })
        } catch (err) {
          // log 写盘失败不应回滚 card.status(已落盘);仅记日志告警
          req.log.error(
            { err, reqId: req.params.id },
            'board PATCH status: override log write failed',
          )
        }
      }

      return reply.code(200).send({
        ok: true,
        card: updated,
        override_applied: !guardResult.ok && override,
      })
    },
  )
}
