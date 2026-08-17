/**
 * boardCardRoutes —— board section 的 TaskCard REST 端点(issue 02 / ADR-0024)
 *
 * 5 条端点:
 *   GET    /api/requirement/:id/board/cards              —— 列表(支持 status / priority / source / label / include_archived 过滤)
 *   GET    /api/requirement/:id/board/cards/:cardId      —— 单卡
 *   POST   /api/requirement/:id/board/cards              —— manual 创建(source='manual', parent_id=reqId)
 *   PATCH  /api/requirement/:id/board/cards/:cardId      —— 字段白名单 PATCH(updated_at 自动改写)
 *   POST   /api/requirement/:id/board/cards/:cardId/archive —— 软删(is_archived=true)
 *
 * 错误返回:`{error, reason}` 形态,400 / 404 / 500 区分;`reason` 走 shared.REASON_TO_HTTP_STATUS_BOARD。
 *
 * 注:**本路由不动 `ClaudeCodeProvider` / `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter`**;
 * `PATCH /status` 走 `routes/board.ts`(issue 03 · ADR-0027 守门测试),不在本文件。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  BoardCardCreateRequestSchema,
  BoardCardListFilterSchema,
  BoardCardPatchSchema,
  REASON_TO_HTTP_STATUS_BOARD,
  type BoardCardBlockers,
  type BoardCardFailReason,
} from '@ai-devspace/shared'
import {
  TaskCardStore,
  TaskCardStoreError,
  type TaskCardStoreDeps,
} from '../services/board/TaskCardStore.js'
import { getBlockers } from '../services/board/get-blockers.js'

export interface BoardCardRoutesDeps {
  /** 未注入时所有端点 503 `service_not_ready`(与其他 routes 风格一致) */
  store?: TaskCardStore
}

/**
 * `TaskCardStoreError.code` → 路由 reason 映射:
 * - E_REQUIREMENT_NOT_FOUND → 'requirement-not-found'
 * - E_CARD_NOT_FOUND        → 'card-not-found'
 * - E_INVALID_CARD_ID       → 'invalid-id'
 * - E_INVALID_INPUT         → 'invalid-body'(字段白名单 PATCH / 构造失败都算 invalid-body)
 * - E_IO                    → 'internal'
 */
function storeErrorToReason(err: TaskCardStoreError): BoardCardFailReason {
  switch (err.code) {
    case 'E_REQUIREMENT_NOT_FOUND':
      return 'requirement-not-found'
    case 'E_CARD_NOT_FOUND':
      return 'card-not-found'
    case 'E_INVALID_CARD_ID':
      return 'invalid-id'
    case 'E_INVALID_INPUT':
      return 'invalid-body'
    case 'E_IO':
      return 'internal'
  }
}

/**
 * 错误响应统一形态:`{ error: code, reason, message }`。
 * code/status 查 `REASON_TO_HTTP_STATUS_BOARD`;message 取 `err.message`。
 */
function failWith(
  reply: FastifyReply,
  reason: BoardCardFailReason,
  message: string,
  log?: FastifyRequest['log'],
): FastifyReply {
  const { code, status } = REASON_TO_HTTP_STATUS_BOARD[reason]
  if (log) log.warn({ reason, code, message }, 'board card request failed')
  return reply.code(status).send({ error: code, reason, message })
}

export async function boardCardRoutes(
  app: FastifyInstance,
  deps: BoardCardRoutesDeps = {},
): Promise<void> {
  // ==========================================================================
  // GET /api/requirement/:id/board/cards
  // ==========================================================================
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/requirement/:id/board/cards',
    async (req, reply) => {
      const { store } = deps
      if (!store) return reply.code(503).send({ error: 'service_not_ready' })

      const { id } = req.params
      if (!store.exists(id)) {
        return failWith(reply, 'requirement-not-found', `requirement ${id} not found`, req.log)
      }

      // querystring 解析:所有字段可选,空对象允许(→ 默认过滤)
      const filterParsed = BoardCardListFilterSchema.safeParse(req.query)
      if (!filterParsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid query: ${filterParsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      const cards = store.list(id, {
        includeArchived: filterParsed.data.include_archived,
        status: filterParsed.data.status,
        priority: filterParsed.data.priority,
        source: filterParsed.data.source,
        label: filterParsed.data.label,
      })
      return reply.code(200).send({
        requirementId: id,
        cards,
        total: cards.length,
      })
    },
  )

  // ==========================================================================
  // GET /api/requirement/:id/board/cards/:cardId
  // ==========================================================================
  app.get<{ Params: { id: string; cardId: string } }>(
    '/api/requirement/:id/board/cards/:cardId',
    async (req, reply) => {
      const { store } = deps
      if (!store) return reply.code(503).send({ error: 'service_not_ready' })

      const { id, cardId } = req.params
      if (!store.exists(id)) {
        return failWith(reply, 'requirement-not-found', `requirement ${id} not found`, req.log)
      }
      const card = store.get(id, cardId)
      if (!card) {
        return failWith(reply, 'card-not-found', `card ${cardId} not found in req ${id}`, req.log)
      }
      return reply.code(200).send({ card })
    },
  )

  // ==========================================================================
  // POST /api/requirement/:id/board/cards —— manual 创建
  // ==========================================================================
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/requirement/:id/board/cards',
    async (req, reply) => {
      const { store } = deps
      if (!store) return reply.code(503).send({ error: 'service_not_ready' })

      const parsed = BoardCardCreateRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid create body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      try {
        const card = store.create(req.params.id, parsed.data)
        return reply.code(201).send({ card })
      } catch (err) {
        if (err instanceof TaskCardStoreError) {
          return failWith(reply, storeErrorToReason(err), err.message, req.log)
        }
        req.log.error({ err }, 'create card failed unexpectedly')
        return failWith(reply, 'internal', 'internal error', req.log)
      }
    },
  )

  // ==========================================================================
  // PATCH /api/requirement/:id/board/cards/:cardId —— 字段白名单
  // ==========================================================================
  app.patch<{ Params: { id: string; cardId: string }; Body: unknown }>(
    '/api/requirement/:id/board/cards/:cardId',
    async (req, reply) => {
      const { store } = deps
      if (!store) return reply.code(503).send({ error: 'service_not_ready' })

      const parsed = BoardCardPatchSchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid patch body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      try {
        const card = store.update(req.params.id, req.params.cardId, parsed.data)
        return reply.code(200).send({ card })
      } catch (err) {
        if (err instanceof TaskCardStoreError) {
          return failWith(reply, storeErrorToReason(err), err.message, req.log)
        }
        req.log.error({ err }, 'patch card failed unexpectedly')
        return failWith(reply, 'internal', 'internal error', req.log)
      }
    },
  )

  // ==========================================================================
  // POST /api/requirement/:id/board/cards/:cardId/archive —— 软删
  // ==========================================================================
  app.post<{ Params: { id: string; cardId: string } }>(
    '/api/requirement/:id/board/cards/:cardId/archive',
    async (req, reply) => {
      const { store } = deps
      if (!store) return reply.code(503).send({ error: 'service_not_ready' })

      try {
        const card = store.archive(req.params.id, req.params.cardId)
        return reply.code(200).send({ card })
      } catch (err) {
        if (err instanceof TaskCardStoreError) {
          return failWith(reply, storeErrorToReason(err), err.message, req.log)
        }
        req.log.error({ err }, 'archive card failed unexpectedly')
        return failWith(reply, 'internal', 'internal error', req.log)
      }
    },
  )

  // ==========================================================================
  // DELETE /api/requirement/:id/board/cards/:cardId —— 物理删除(ADR-0036)
  //
  // 流程:
  //   1. req 目录存在? 否 → 404 requirement-not-found
  //   2. card 存在? 否 → 404 card-not-found(包含幂等二次访问)
  //   3. blocker 检查(子任务 / 依赖方)→ 命中 → 409 card-has-blockers
  //   4. 调 store.delete(id, cardId) → 200 { deleted: true }
  //
  // blocker 检查放 route 层而非 store 层:store 职责单一(物理删),
  // blocker 是业务规则(可能因后续批量真删复用但与单卡物理删解耦)。
  // ==========================================================================
  app.delete<{ Params: { id: string; cardId: string } }>(
    '/api/requirement/:id/board/cards/:cardId',
    async (req, reply) => {
      const { store } = deps
      if (!store) return reply.code(503).send({ error: 'service_not_ready' })

      const { id, cardId } = req.params

      if (!store.exists(id)) {
        return failWith(
          reply,
          'requirement-not-found',
          `requirement ${id} not found`,
          req.log,
        )
      }
      const card = store.get(id, cardId)
      if (!card) {
        return failWith(
          reply,
          'card-not-found',
          `card ${cardId} not found in req ${id}`,
          req.log,
        )
      }

      // blocker 检查 —— ADR-0036 D2
      const allCards = store.list(id, { includeArchived: false })
      const blockers = getBlockers(allCards, cardId)
      if (blockers.subtasks.length > 0 || blockers.dependents.length > 0) {
        req.log.warn(
          { cardId, blockers },
          'delete card blocked by subtasks/dependents',
        )
        const blockersPayload: BoardCardBlockers = blockers
        return reply.code(409).send({
          error: 'E_CARD_HAS_BLOCKERS',
          reason: 'card-has-blockers',
          message: `cannot delete card ${cardId}: ${blockers.subtasks.length} subtask(s), ${blockers.dependents.length} dependent(s)`,
          blockers: blockersPayload,
        })
      }

      // 物理删除 —— store 内部串行锁 + rm -rf
      try {
        await store.delete(id, cardId)
        return reply.code(200).send({ deleted: true, id: cardId })
      } catch (err) {
        if (err instanceof TaskCardStoreError) {
          return failWith(reply, storeErrorToReason(err), err.message, req.log)
        }
        req.log.error({ err }, 'delete card failed unexpectedly')
        return failWith(reply, 'internal', 'internal error', req.log)
      }
    },
  )
}

// 显式 re-export 依赖类型,便于 route 测试 stub
export type { TaskCardStoreDeps }
