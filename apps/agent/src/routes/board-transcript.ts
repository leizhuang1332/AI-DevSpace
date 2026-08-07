/**
 * boardTranscriptRoutes —— TaskCard transcript REST 端点(issue 08 / ADR-0028 D5)
 *
 * 2 条端点:
 *   GET  /api/requirement/:id/board/cards/:cardId/transcript
 *     读 transcript;文件不存在 → 200 {transcript: null}(SSR 容错,UI 走空态)
 *   POST /api/requirement/:id/board/cards/:cardId/transcript/messages
 *     body: {content, refs?} → 追加一条 user 消息,返回追加后的完整 transcript
 *
 * 守门(ADR-0028 D2 · TaskCard transcript 仅描述,不挂 Run):
 * - **强制 role='user'** —— caller 传 role 字段被忽略;TaskCard transcript 的
 *   assistant 消息只能由 Run 路径写入,本路由是 web 详情页用户输入入口
 * - tool_calls 由 `TaskCardTranscriptService.appendMessage` 强制 [](服务层守门)
 * - ts 由服务层写(caller 不传 ts)
 *
 * 错误返回:复用 `REASON_TO_HTTP_STATUS_BOARD`(card-not-found 404 /
 * requirement-not-found 404 / invalid-body 400 / internal 500),
 * 镜像 `board-cards.ts` 的 `failWith` 模式。
 *
 * 注:**不动 ClaudeCodeProvider / runAnalysisQuery / createSdkMcpServer / mcpCallCounter**;
 * 本路由是纯文件 IO(读写 transcript.yaml),零触达 Run 路径。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  REASON_TO_HTTP_STATUS_BOARD,
  TranscriptMessageCreateBodySchema,
  type BoardCardFailReason,
} from '@ai-devspace/shared'
import type { TaskCardTranscriptService } from '../services/board/TaskCardTranscript.js'
import type { TaskCardStore } from '../services/board/TaskCardStore.js'

export interface BoardTranscriptRoutesDeps {
  taskCardStore: TaskCardStore
  transcriptService: TaskCardTranscriptService
}

/** 错误响应统一形态:`{ error: code, reason, message }`(镜像 board-cards.ts) */
function failWith(
  reply: FastifyReply,
  reason: BoardCardFailReason,
  message: string,
  log?: FastifyRequest['log'],
): FastifyReply {
  const { code, status } = REASON_TO_HTTP_STATUS_BOARD[reason]
  if (log) log.warn({ reason, code, message }, 'board transcript request failed')
  return reply.code(status).send({ error: code, reason, message })
}

export async function boardTranscriptRoutes(
  app: FastifyInstance,
  deps: BoardTranscriptRoutesDeps,
): Promise<void> {
  const { taskCardStore: store, transcriptService } = deps

  // ==========================================================================
  // GET /api/requirement/:id/board/cards/:cardId/transcript
  // ==========================================================================
  app.get<{ Params: { id: string; cardId: string } }>(
    '/api/requirement/:id/board/cards/:cardId/transcript',
    async (req, reply) => {
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
      // 文件不存在 → transcript=null(UI 走空态,不阻塞渲染)
      const transcript = transcriptService.read(id, cardId)
      return reply.code(200).send({ transcript })
    },
  )

  // ==========================================================================
  // POST /api/requirement/:id/board/cards/:cardId/transcript/messages
  // ==========================================================================
  app.post<{ Params: { id: string; cardId: string }; Body: unknown }>(
    '/api/requirement/:id/board/cards/:cardId/transcript/messages',
    async (req, reply) => {
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

      const parsed = TranscriptMessageCreateBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return failWith(
          reply,
          'invalid-body',
          `invalid message body: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          req.log,
        )
      }

      // 守门:强制 role='user' —— caller 传 role 也会被忽略(ADR-0028 D2)
      // appendMessage 自动创建初始 transcript(派生父 snapshot)若文件不存在;
      // ts 由服务层写;tool_calls 强制 [](服务层守门)
      try {
        const transcript = transcriptService.appendMessage(id, cardId, {
          role: 'user',
          content: parsed.data.content,
          refs: parsed.data.refs,
        })
        return reply.code(200).send({ transcript })
      } catch (err) {
        req.log.error(
          { err, reqId: id, cardId },
          'board transcript: appendMessage failed',
        )
        return failWith(
          reply,
          'internal',
          err instanceof Error ? err.message : 'internal error',
          req.log,
        )
      }
    },
  )
}
