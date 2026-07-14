/**
 * Session state REST 路由 —— ADR-0010 Q10.4 + 决策 49 StatusBar 4 指示器
 *
 * 端点:
 *  - GET /api/sessions/:localSid/state       单 session 快照(StatusBar refresh)
 *  - GET /api/sessions/state/all             全局 StatusBar 总览(4 指示器)
 *
 * 决策 49 要求:
 *  - 状态色码:灰(idle) / 蓝脉动(观察中) / 黄(思考中) / 绿闪(等回答) / 红(出错)
 *  - 待回答 N / 候命 N / 最近写入 N
 *  - 状态变化静默更新(不 Toast,不弹窗) —— 这里只读,不主动推
 *  - 5 类必沉默(Web 端在自己 reducer 里评估;Agent 只暴露状态)
 *
 * 本期 Agent 输出的是 raw 状态 + 计数;Web 端在 reducer 里映射到色码,
 * 并根据 5 类必沉默(决策 44)选择 Inline 提示栏 + 活动流的可见性。
 */

import type { FastifyPluginAsync } from 'fastify'
import type { SessionStateRegistry } from '../session/SessionStateRegistry.js'
import type { SessionStore } from '../session/SessionStore.js'

export interface SessionStateRoutesOptions {
  registry: SessionStateRegistry
  store: SessionStore
}

export const sessionStateRoutes: FastifyPluginAsync<SessionStateRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { registry, store } = opts

  // 单 session 状态 —— Web 端在初次打开 / 刷新 StatusBar 时调用
  fastify.get<{ Params: { localSid: string } }>(
    '/api/sessions/:localSid/state',
    async (req, reply) => {
      const { localSid } = req.params
      // 优先读 registry(活 session,有最新 state);活 session 不存在 → 读 store(已落盘)
      const live = registry.get(localSid)
      if (live) return reply.code(200).send(live)
      const meta = await store.getSession(localSid).catch(() => null)
      if (!meta) {
        return reply.code(404).send({
          error: 'session_not_found',
          message: `Session ${localSid} not found`,
        })
      }
      // 历史 session(meta 已存在但 live 不在)→ 视作 closed
      return reply.code(200).send({
        localSid: meta.sid,
        reqId: meta.reqId,
        state: 'closed' as const,
        recentWrites: 0,
        ts: Date.now(),
      })
    },
  )

  // 全局 StatusBar 4 指示器 —— pending / queued / recentWrites / stateCounts
  fastify.get('/api/sessions/state/all', async (_req, reply) => {
    return reply.code(200).send(registry.statusBar())
  })
}