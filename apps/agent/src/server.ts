import Fastify from 'fastify'
import cors from '@fastify/cors'
import { fileURLToPath } from 'node:url'
import { WorkspaceService } from './services/WorkspaceService.js'
import { workspaceRoutes } from './routes/workspace.js'

// 占位 CORS 白名单 — 当前仅放行本机 Web（3333）。issue 03 引入动态 Token + Origin 鉴权时一并收紧。
// 现阶段不视为安全边界；非浏览器客户端（如 CLI）需绕过 CORS 时后续单独讨论。
const ALLOWED_ORIGINS: string[] = ['http://localhost:3333', 'http://127.0.0.1:3333']

export async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  })

  await fastify.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })

  // Workspace service 单例：boot 时 init（幂等）
  const workspace = new WorkspaceService(WorkspaceService.resolveRoot())
  try {
    await workspace.initWorkspace()
    fastify.log.info({ root: workspace.root }, 'workspace initialized')
  } catch (err) {
    fastify.log.error({ err, root: workspace.root }, 'workspace init failed')
    throw err // 让 isMain 块的 catch 退出进程（spec §4.5）
  }

  await workspaceRoutes(fastify, { workspace })

  fastify.get('/api/health', async () => {
    return { ok: true, name: 'agent', workspaceRoot: workspace.root }
  })

  return fastify
}

// 跨平台 isMain 检测（Windows 下 process.argv[1] 是反斜杠路径，import.meta.url 是 file:// URL）
const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : ''
const isMain = entryPath === process.argv[1]

if (isMain) {
  const port = Number(process.env.PORT ?? 7777)
  const host = process.env.HOST ?? '0.0.0.0'
  const app = await buildServer()
  try {
    await app.listen({ port, host })
    app.log.info(`agent listening on http://${host}:${port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
