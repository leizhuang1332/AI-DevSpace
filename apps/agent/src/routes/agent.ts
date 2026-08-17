/**
 * Agent lifecycle HTTP routes (ADR-0037 D4 / issue 04)
 *
 * - POST /api/agent/restart
 *   流程:
 *   (a) SSE 广播 `{type:'agent-restarting', reason, ts}` 给所有订阅者
 *   (b) closeAllSseConnections(hub) —— SseHub.close
 *   (c) shutdownSdkSubprocess(provider) —— provider.shutdown
 *   (d) setTimeout(exitFn, 200) —— 给 SSE 200ms flush 时间;exitFn 默认 process.exit(0),
 *       测试可注入 fakeExit(同步函数)避免 process.exit 真退
 *
 *   **注**: `process.exit` 由 supervisor(tsx watch / pm2 / docker / npm)重新拉起;
 *   没 supervisor 时,用户须手动 `pnpm dev` 重启(见 supervisor-detect 启动期 warning)。
 */
import type { FastifyInstance } from 'fastify'
import type { AgentRestartReason } from '@ai-devspace/shared'
import type { SseHub } from '../sse/SseHub.js'
import type { AIProvider } from '../providers/AIProvider.js'
import {
  closeAllSseConnections,
  shutdownSdkSubprocess,
} from '../services/AgentLifecycle.js'
import { WorkspaceErrorCode } from '../error/WorkspaceErrorCodes.js'

export interface AgentRouteDeps {
  hub: SseHub
  provider: AIProvider
  /** 测试可注入: 默认 `process.exit(0)`。同步函数。 */
  exitFn?: (code: number) => void
  /** 测试可注入: 默认 200ms。0 = 立即触发。 */
  exitDelayMs?: number
}

const VALID_REASONS: readonly AgentRestartReason[] = [
  'workspaceRoot-changed',
  'manual-restart',
  'config-changed',
] as const

export async function agentRoutes(
  app: FastifyInstance,
  deps: AgentRouteDeps,
): Promise<void> {
  const exitFn = deps.exitFn ?? ((code: number) => process.exit(code))
  const exitDelayMs = deps.exitDelayMs ?? 200

  app.post('/api/agent/restart', async (req, reply) => {
    const body = (req.body ?? {}) as { reason?: unknown }
    const reasonRaw = typeof body.reason === 'string' ? body.reason : 'manual-restart'
    const reason: AgentRestartReason = (VALID_REASONS as readonly string[]).includes(
      reasonRaw,
    )
      ? (reasonRaw as AgentRestartReason)
      : 'manual-restart'

    const ts = Date.now()
    try {
      // (a) 广播即将退出 —— SseHub.publishAll 不分通道
      deps.hub.publishAll({ type: 'agent-restarting', reason, ts })
      // (b) + (c) 清理 SSE 连接 + SDK 子进程
      await closeAllSseConnections(deps.hub)
      await shutdownSdkSubprocess(deps.provider)
      // (d) 给 SSE 200ms flush 时间后退出 —— supervisor 会拉起新进程
      setTimeout(() => exitFn(0), exitDelayMs)
      return reply.code(202).send({
        ok: true,
        reason,
        ts,
        message: 'Agent 正在重启,客户端将在 1-2 秒后自动重连',
      })
    } catch (err) {
      app.log.error({ err }, 'agent restart failed')
      return reply.code(500).send({
        error: WorkspaceErrorCode.E_AGENT_RESTART_FAILED,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}