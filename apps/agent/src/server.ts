import Fastify from 'fastify'
import cors from '@fastify/cors'
import { fileURLToPath } from 'node:url'

// 占位 CORS 白名单 — 当前仅放行本机 Web（3333）。issue 03 引入动态 Token + Origin 鉴权时一并收紧。
// 现阶段不视为安全边界；非浏览器客户端（如 CLI）需绕过 CORS 时后续单独讨论。
const ALLOWED_ORIGINS = ['http://localhost:3333', 'http://127.0.0.1:3333'] as const

export async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  })

  await fastify.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })

  // 占位路由 — 完整路由（SSE / workspace / requirement / repo / knowledge / skill / command）
  // 由 issue 03 / 05-11 补齐。鉴权中间件由 issue 03 引入。
  fastify.get('/api/health', async () => {
    return { ok: true, name: 'agent' }
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
