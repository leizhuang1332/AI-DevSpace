/**
 * Agent 生命周期辅助函数(ADR-0037 D4)
 *
 * 把 server.ts 内的 cleanup 路径抽出来,便于单测与复用:
 *  - closeAllSseConnections: 关闭 SseHub(等价于 fastify.addHook('onClose', ...) 内的 hub.close())
 *  - shutdownSdkSubprocess: 关闭 AIProvider 子进程(SDK / provider.shutdown)
 *
 * 「进程退出」由 route 层 setTimeout 触发,不在这里调 process.exit —— 留给
 * supervisor(tsx watch / pm2 / docker / npm)决定何时拉起新进程。
 */
import type { SseHub } from '../sse/SseHub.js'
import type { AIProvider } from '../providers/AIProvider.js'

export async function closeAllSseConnections(hub: SseHub): Promise<void> {
  await hub.close()
}

export async function shutdownSdkSubprocess(provider: AIProvider): Promise<void> {
  await provider.shutdown()
}