/**
 * Spike Routes —— ADR-0010 P0 验收
 *
 * 端点:
 *   - POST /api/spike/run —— 启动一次 SDK query,把 AIEvent 通过 SseHub 推到 /api/spike/events 订阅者
 *   - GET  /api/spike/events —— SSE 订阅;订阅时发 hello,接收 spike.run 的 AIEvent 流
 *
 * 通道策略:Q10.2 在 P5 才做 N 条独立 SSE;P0 阶段先 1 条全局 spike 通道
 * —— 即 SseHub.subscribe 的 reqId 统一为常量 'spike'。
 *
 * 请求体:
 *   POST /api/spike/run
 *     {
 *       "prompt": "hi",
 *       "reqId"?: "spike"   // 默认 'spike',P5 后才让 web 端用真实 reqId
 *     }
 *
 * 设计要点:
 * - **同步 ack + 异步流**:run 接口立即返回 202 + runId;events 通过 SSE 异步推到订阅者
 * - **CC-Switch 启动日志**:route 注册时打印「cc-switch 当前 provider / model.main」
 *   (issue 验收第 1 条)
 */

import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from '../sse/SseHub.js'
import type { AIEvent } from '../providers/AIEvent.js'
import type { AIProvider } from '../providers/AIProvider.js'
import type { CcSwitchClient } from '../providers/CcSwitchClient.js'

/** P0 阶段固定通道 id;P5 会改成 per-session N 通道 */
export const SPIKE_CHANNEL = 'spike'

export interface SpikeRoutesOptions {
  hub: SseHub
  /** 单例 AIProvider —— Agent 启动时构造一次 */
  provider: AIProvider
  /** 单例 CcSwitchClient —— Agent 启动时构造一次;route 用于打印启动日志 */
  ccSwitch: CcSwitchClient
}

interface RunBody {
  prompt?: unknown
  reqId?: unknown
}

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export const spikeRoutes: FastifyPluginAsync<SpikeRoutesOptions> = async (fastify, opts) => {
  const { hub, provider, ccSwitch } = opts

  // 启动日志 —— issue 验收第 1 条
  const current = ccSwitch.getCurrent()
  if (current) {
    fastify.log.info(
      { provider: current.name, baseUrl: current.baseUrl, models: current.models },
      '[spike] cc-switch current provider',
    )
  } else {
    fastify.log.warn('[spike] no cc-switch claude provider configured')
  }

  // GET /api/spike/events —— SSE 订阅(public: spike 阶段供 curl 直接验证,P5 观测性接 web 时再加 auth)
  fastify.get('/api/spike/events', { config: { public: true } }, async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.hijack()

    const sid = randomUUID()
    const write = (event: SseEvent): void => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      } catch {
        /* socket already closed */
      }
    }

    write({ type: 'hello', sid, reqId: SPIKE_CHANNEL, ts: Date.now() })

    const unsubscribe = hub.subscribe(SPIKE_CHANNEL, write)
    const cleanup = (): void => {
      unsubscribe()
      reply.raw.off('close', cleanup)
    }
    reply.raw.on('close', cleanup)
  })

  // POST /api/spike/run —— 启动 SDK query(public: 同上,spike 阶段免 auth)
  fastify.post<{ Body: RunBody }>('/api/spike/run', { config: { public: true } }, async (req, reply) => {
    const body = req.body ?? {}
    if (!isNonEmptyString(body.prompt)) {
      return reply.code(400).send(badRequest('prompt is required and must be non-empty'))
    }
    const prompt = body.prompt
    const reqId = isNonEmptyString(body.reqId) ? body.reqId : SPIKE_CHANNEL

    const runId = randomUUID()
    fastify.log.info(
      { runId, reqId, promptPreview: prompt.slice(0, 60) },
      '[spike] /run starting SDK query',
    )

    // 异步推流 —— 不阻塞 POST 返回
    void (async (): Promise<void> => {
      try {
        const session = await provider.createSession(reqId, {
          topic: 'spike',
          kind: 'chat',
        })

        // 把 AIEvent 通过 hub 推到订阅者(每条都包一层 SseEvent 形态)
        void (async (): Promise<void> => {
          try {
            for await (const ev of session.events()) {
              // 我们用一个统一的 'analysis_chunk' 形态包装(与现有 web 端契约一致)?
              // 不:spike 阶段 web 端还没接通,先把 AIEvent 原样吐出去,后续 P5 再细化
              const sseEvent: SseEvent = wrapAiEventAsSse(runId, reqId, ev)
              hub.publish(reqId, sseEvent)
            }
          } catch (err) {
            fastify.log.error({ err, runId }, '[spike] event pump threw')
          }
        })()

        await session.send(prompt)
        await session.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        fastify.log.error({ err, runId }, '[spike] run failed')
        hub.publish(reqId, {
          type: 'placeholder',
          message: `[spike] run failed: ${message}`,
        })
      }
    })()

    return reply.code(202).send({
      status: 'accepted',
      runId,
      reqId,
      promptPreview: prompt.slice(0, 80),
    })
  })
}

/**
 * 把 AIEvent 包成 SseEvent。
 * 注意:shared SseEvent 联合目前只覆盖 hello/heartbeat/placeholder/analysis_chunk;
 * P0 阶段我们用 placeholder 把 AIEvent 当 message 字段塞,让 web 端调试时能拿到完整形态。
 * P5 再扩 SseEvent 联合(type: 'ai_event')。
 */
function wrapAiEventAsSse(runId: string, reqId: string, ev: AIEvent): SseEvent {
  return {
    type: 'placeholder',
    message: JSON.stringify({ runId, reqId, ev }),
  }
}