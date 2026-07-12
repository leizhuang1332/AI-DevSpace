/**
 * ANALYZING 工位 Agent REST endpoints(ADR-0013 D2 ② · issue 19b/19e/19f)
 *
 * 当前 slice(19b VS2)只覆盖:
 * - POST /api/requirements/:id/analysis/interject —— 用户插话,启动 admission-check
 *   Skill → 产生新 chunks → 通过 SseHub.publish 推给该 reqId 的所有 SSE 订阅者
 *
 * 后续 slice(19e/19f)再扩展:
 * - POST /api/requirements/:id/analysis/regenerate  -- 重扫
 * - POST /api/requirements/:id/analysis/adjudicate  -- 裁决写入 + 应用
 * - POST /api/requirements/:id/analysis/generate-brief -- 生成技术概要
 *
 * 设计要点:
 * - 接受 { text, session_id } body,缺失字段 → 400
 * - 返回 202(Accepted)+ ack —— chunks 是异步通过 SSE 推到客户端的,不阻塞 POST 返回
 * - 当前 mock 阶段没有真实 Skill runtime,模拟 admission-check Skill 收到用户输入后
 *   产生 1-2 条 acknowledgment chunk + 1 条 THINK chunk;真实 Skill 接通后此函数替换为
 *   Skill runner 调用
 */

import type { FastifyPluginAsync } from 'fastify'
import type { SseHub } from '../sse/SseHub.js'

export interface AnalysisRoutesOptions {
  hub: SseHub
}

interface InterjectBody {
  text?: unknown
  session_id?: unknown
}

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** 模拟 admission-check Skill 在收到用户插话后的输出 chunks。
 *  真实 Skill 接通后,此处替换为 Skill runner 调用,返回值不变。 */
function simulateInterjectChunks(params: {
  requirementId: string
  sessionId: string
  userText: string
}): { ts: number; type: 'analysis_chunk'; reqId: string; sessionId: string; chunk: { id: string; ts: string; label: string; kind: 'narration' | 'subproblem' | 'risk' | 'option'; tone: 'info' | 'success' | 'warn' | 'err'; text: string } }[] {
  const now = new Date()
  const tsStr = now.toTimeString().slice(0, 8) // HH:MM:SS
  const minute = now.getMinutes().toString().padStart(2, '0')
  const second = now.getSeconds().toString().padStart(2, '0')
  const stamp = `${now.getHours().toString().padStart(2, '0')}:${minute}:${second}`
  void tsStr
  return [
    {
      ts: Date.now(),
      type: 'analysis_chunk',
      reqId: params.requirementId,
      sessionId: params.sessionId,
      chunk: {
        id: `c-interject-${Date.now()}-ack`,
        ts: stamp,
        label: 'INFER',
        kind: 'narration',
        tone: 'info',
        text: `已接收用户插话:${params.userText.slice(0, 32)}${params.userText.length > 32 ? '…' : ''}`,
      },
    },
    {
      ts: Date.now() + 1,
      type: 'analysis_chunk',
      reqId: params.requirementId,
      sessionId: params.sessionId,
      chunk: {
        id: `c-interject-${Date.now()}-think`,
        ts: stamp,
        label: 'THINK',
        kind: 'narration',
        tone: 'info',
        text: '正在基于用户输入重新评估准入维度...',
      },
    },
  ]
}

export const analysisRoutes: FastifyPluginAsync<AnalysisRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { hub } = opts

  fastify.post<{
    Params: { id: string }
    Body: InterjectBody
  }>('/api/requirements/:id/analysis/interject', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}

    if (!isNonEmptyString(body.text)) {
      return reply.code(400).send(badRequest('text is required and must be non-empty'))
    }
    if (!isNonEmptyString(body.session_id)) {
      return reply.code(400).send(badRequest('session_id is required and must be non-empty'))
    }

    const userText = body.text
    const sessionId = body.session_id

    // 模拟 admission-check Skill 收到用户输入,产出新 chunks;通过 SseHub 推送
    const chunks = simulateInterjectChunks({
      requirementId: id,
      sessionId,
      userText,
    })
    for (const ev of chunks) {
      hub.publish(id, ev)
    }

    return reply.code(202).send({
      status: 'accepted',
      requirementId: id,
      sessionId,
      chunksQueued: chunks.length,
    })
  })
}
