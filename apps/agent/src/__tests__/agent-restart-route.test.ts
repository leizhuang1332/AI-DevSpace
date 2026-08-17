/**
 * Agent lifecycle routes (ADR-0037 D4 / issue 04)
 *
 * 5 case (实际跑 8 case,补充分支):
 *  1. POST /api/agent/restart happy path → 202 + reason + ts,exitFn(0) 在 exitDelayMs 后被调
 *  2. 默认 reason(无 body)→ 202 + reason=manual-restart
 *  3. 非法 reason → fallback 到 manual-restart(不抛)
 *  4. cleanup 抛错(provider.shutdown 抛) → 500 E_AGENT_RESTART_FAILED,不调 exitFn
 *  5. SSE agent-restarting 广播 publishAll → 所有通道订阅者都收到
 *
 *  detectSupervisor 4 启发式: TSX_WATCH / PM2 / 父进程名 / 无 supervisor → hint
 *
 * 不走 buildServer —— agentRoutes 是独立 plugin,直接 fastify.register + 注入
 * fake hub/provider/exitFn/exitDelayMs = 0,避免 process.exit 真退污染 worker。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, existsSync as fsExists } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentRoutes } from '../routes/agent.js'
import { detectSupervisor } from '../lib/supervisor-detect.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import type { AIProvider } from '../providers/AIProvider.js'

let tmpRoot: string
let app: FastifyInstance
let hub: SseHub
let provider: AIProvider & { shutdown: ReturnType<typeof vi.fn> }
let exitFn: ReturnType<typeof vi.fn>
let exitDelayMs = 0

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-agent-restart-'))
  hub = createSseHub()
  provider = {
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as AIProvider & { shutdown: ReturnType<typeof vi.fn> }
  exitFn = vi.fn()

  app = Fastify({ logger: false })
  await app.register(agentRoutes, {
    hub,
    provider,
    exitFn,
    exitDelayMs,
  })
  await app.ready()
})

afterEach(async () => {
  if (app) await app.close()
  await hub.close()
  if (fsExists(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 1-5. POST /api/agent/restart
// ---------------------------------------------------------------------------

describe('POST /api/agent/restart', () => {
  it('case 1: happy path → 202 + reason + ts,exitFn(0) 在 exitDelayMs 后被调', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/restart',
      payload: { reason: 'workspaceRoot-changed' },
    })
    expect(res.statusCode).toBe(202)
    const body = res.json() as { ok: boolean; reason: string; ts: number; message: string }
    expect(body.ok).toBe(true)
    expect(body.reason).toBe('workspaceRoot-changed')
    expect(typeof body.ts).toBe('number')
    expect(body.ts).toBeLessThanOrEqual(Date.now())
    expect(typeof body.message).toBe('string')

    // exitDelayMs=0 → setTimeout 下一拍;让 macrotask flush
    await new Promise((r) => setTimeout(r, 10))
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('case 2: 默认 reason(无 body)→ 202 + reason=manual-restart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/restart',
      payload: {},
    })
    expect(res.statusCode).toBe(202)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('manual-restart')
  })

  it('case 3: 非法 reason → fallback 到 manual-restart(不抛)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/restart',
      payload: { reason: 'totally-bogus-reason' },
    })
    expect(res.statusCode).toBe(202)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('manual-restart')
  })

  it('case 4: cleanup 抛错 → 500 E_AGENT_RESTART_FAILED,不调 exitFn', async () => {
    provider.shutdown.mockRejectedValueOnce(new Error('SDK subprocess down'))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/restart',
      payload: { reason: 'manual-restart' },
    })
    expect(res.statusCode).toBe(500)
    const body = res.json() as { error: string; message: string }
    expect(body.error).toBe('E_AGENT_RESTART_FAILED')
    expect(body.message).toContain('SDK subprocess down')

    await new Promise((r) => setTimeout(r, 10))
    expect(exitFn).not.toHaveBeenCalled()
  })

  it('case 5: SSE agent-restarting 广播 publishAll → 跨通道订阅者都收到', async () => {
    // 订阅 2 个不同通道 + 一个全局旁路(replay hub 上的任意 channel)
    const receivedA: unknown[] = []
    const receivedB: unknown[] = []
    hub.subscribe('req-A', (e) => receivedA.push(e))
    hub.subscribe('requirements', (e) => receivedB.push(e))

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/restart',
      payload: { reason: 'config-changed' },
    })
    expect(res.statusCode).toBe(202)

    expect(receivedA).toHaveLength(1)
    expect(receivedB).toHaveLength(1)
    expect(receivedA[0]).toMatchObject({
      type: 'agent-restarting',
      reason: 'config-changed',
    })
    expect(receivedB[0]).toMatchObject({
      type: 'agent-restarting',
      reason: 'config-changed',
    })
  })
})

// ---------------------------------------------------------------------------
// 6-9. detectSupervisor 启发式
// ---------------------------------------------------------------------------

describe('detectSupervisor 启发式 (ADR-0037 D4)', () => {
  it('TSX_WATCH=1 → supervised=true hint=tsx watch', () => {
    process.env.TSX_WATCH = '1'
    try {
      const r = detectSupervisor()
      expect(r.supervised).toBe(true)
      expect(r.hint).toContain('tsx')
    } finally {
      delete process.env.TSX_WATCH
    }
  })

  it('PM2_HOME 存在 → supervised=true hint=pm2', () => {
    process.env.PM2_HOME = '/some/path'
    try {
      const r = detectSupervisor()
      expect(r.supervised).toBe(true)
      expect(r.hint).toBe('pm2')
    } finally {
      delete process.env.PM2_HOME
    }
  })

  it('父进程名含 tsx → supervised=true hint=tsx', () => {
    delete process.env.TSX_WATCH
    delete process.env.PM2_HOME
    delete process.env.KUBERNETES_SERVICE_HOST
    const r = detectSupervisor('/usr/local/bin/tsx watch src/server.ts')
    expect(r.supervised).toBe(true)
    expect(r.hint).toBe('tsx')
  })

  it('无任何 env 标志 + 无父进程名 → supervised=false hint 含 supervisor 关键词', () => {
    delete process.env.TSX_WATCH
    delete process.env.PM2_HOME
    delete process.env.KUBERNETES_SERVICE_HOST
    const r = detectSupervisor()
    expect(r.supervised).toBe(false)
    expect(r.hint).toBeTruthy()
    expect(r.hint).toMatch(/supervisor/i)
  })
})