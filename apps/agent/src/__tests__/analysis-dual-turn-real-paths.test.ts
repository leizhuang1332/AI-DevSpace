/**
 * start handler ↔ SDK 文本解析层 wiring + 真实错误路径编排
 * (audit-2026-07-26 关键阻塞项 #2 / #3)
 *
 * 覆盖:
 *  - 真 SDK 形态的 Skill 输出(`[DIM]` / `[VERDICT]` / `[SUBPROBLEM]` ...)
 *    → chunks.jsonl 落**结构化** chunk(kind / source_refs / admission),
 *    不再一律 narration
 *  - SSE 推的 chunk 与 jsonl 行一致
 *  - `session.send()` reject → turn-2 仍执行、session 关闭、job 不挂死
 *  - turn-1 与 turn-2 都 reject → 不挂死,session 仍关闭
 *  - error envelope 中途推流(无 done)+ send reject → 不挂死
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { analysisRoutes } from '../routes/analysis.js'
import { createRecordingProvider } from './__helpers__/fakeAnalysisProvider.js'

let root: string
let fastify: FastifyInstance
let hub: SseHub

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-parse-'))
  hub = createSseHub({ heartbeatMs: 60_000 })
  fastify = Fastify({ logger: false })
})

afterEach(async () => {
  await fastify.close()
  await hub.close()
  rmSync(root, { recursive: true, force: true })
})

function seedReq(reqId: string): void {
  const reqDir = join(root, 'requirements', reqId)
  mkdirSync(reqDir, { recursive: true })
  writeFileSync(join(reqDir, 'requirement.md'), '# 退款优化\n退款单笔金额上限 ≤ 1000 元\n', 'utf8')
}

async function postStart(reqId: string, sessionId: string) {
  return fastify.inject({
    method: 'POST',
    url: `/api/requirements/${reqId}/analysis/start`,
    headers: { 'content-type': 'application/json' },
    payload: { angle: 'architecture', session_id: sessionId },
  })
}

/** chunks.jsonl 行形态:chunk 字段**平铺** + `session_id`(见 appendChunkToJsonl) */
interface JsonlRow {
  id: string
  kind: string
  label: string
  tone: string
  text: string
  session_id: string
  source_refs?: unknown[]
  admission?: { dim?: string; verdict?: string; overall?: string; pendingCount?: number }
}

function readChunks(reqId: string, sessionId: string): JsonlRow[] {
  const p = join(root, 'requirements', reqId, 'analysis', 'sessions', sessionId, 'chunks.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as JsonlRow)
}

/** 真 Skill 输出形态的 turn-1 文本(admission-check SKILL.md 模板) */
const TURN1_TEXT = [
  '[DIM loss_prevention]',
  'verdict: warn',
  'severity: 🔴',
  'evidence: 免审退款缺少风控校验。',
  'pending: 免审额度是否需风控',
  '',
  '[DIM performance]',
  'verdict: pass',
  'evidence: 无高频接口。',
  '',
  '[DIM arch_conflict]',
  'verdict: pass',
  'evidence: 不与现有边界冲突。',
  '',
  '[DIM business_reasonable]',
  'verdict: pass',
  'evidence: 目标清晰。',
  '',
  '[DIM context_query]',
  'verdict: warn',
  'evidence: 上限口径未定义。',
  'pending: 上限口径确认',
  '',
  '[VERDICT]',
  'result: ⚠️',
  'pending_count: 2',
  'summary: 两处待裁决。',
  '',
].join('\n')

/** 真 Skill 输出形态的 turn-2 文本(requirement-brainstorm SKILL.md 模板) */
const TURN2_TEXT = [
  '[SUBPROBLEM]',
  'text: 单笔退款上限是否随用户等级差异化?',
  'source_refs:',
  '  - prd:1-2 "退款单笔金额上限 ≤ 1000 元"',
  '',
  '[RISK]',
  'text: 并发退款可能重复入账。',
  'source_refs:',
  '  - prd:0-2 "退款优化"',
  '',
  '[OPTION]',
  'text: 幂等网关 + 异步多阶段事件。',
  '',
].join('\n')

describe('start handler:SDK 文本 → 结构化 chunk(audit #2)', () => {
  it('turn-1 [DIM]/[VERDICT] → admission 元数据落 jsonl', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        [
          { type: 'text', text: TURN1_TEXT, delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-1' },
        ],
        [{ type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-2' }],
      ],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-parse-dim'
    seedReq(reqId)
    expect((await postStart(reqId, 'sess-dim')).statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 300))

    const chunks = readChunks(reqId, 'sess-dim')
    const dimChunks = chunks.filter((c) => c.admission?.dim)
    expect(dimChunks.map((c) => c.admission?.dim)).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ])
    // 五维卡都拿到一条 chunk ⇒ web 端 count 全部 > 0(ticket 07 E2E 强断言前提)
    expect(dimChunks).toHaveLength(5)
    expect(dimChunks[0].admission?.verdict).toBe('warn')
    expect(dimChunks[0].tone).toBe('warn')
    expect(dimChunks[1].admission?.verdict).toBe('pass')

    const verdictChunk = chunks.find((c) => c.admission?.overall)
    expect(verdictChunk?.admission).toEqual({ overall: 'pending', pendingCount: 2 })
    expect(verdictChunk?.label).toBe('COMPLETE')
    // DIM / VERDICT 都是 narration(不进 ProductList 三桶)
    expect(chunks.every((c) => c.kind === 'narration')).toBe(true)
  })

  it('turn-2 三桶标记 → kind subproblem/risk/option + source_refs', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        [{ type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-1' }],
        [
          { type: 'text', text: TURN2_TEXT, delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-2' },
        ],
      ],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-parse-bucket'
    seedReq(reqId)
    expect((await postStart(reqId, 'sess-bucket')).statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 300))

    const chunks = readChunks(reqId, 'sess-bucket')
    expect(chunks.map((c) => c.kind)).toEqual(['subproblem', 'risk', 'option'])
    expect(chunks[0].source_refs).toEqual([
      { kind: 'prd', lineRange: [1, 2], quote: '退款单笔金额上限 ≤ 1000 元' },
    ])
    // 无 source_refs 的 chunk 不写该字段(JSONL 契约)
    expect('source_refs' in chunks[2]).toBe(false)
  })

  it('SSE 推的 chunk 与 jsonl 行一致(含 admission / source_refs)', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        [
          { type: 'text', text: TURN1_TEXT, delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-1' },
        ],
        [
          { type: 'text', text: TURN2_TEXT, delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-2' },
        ],
      ],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-parse-sse'
    seedReq(reqId)

    // 先订阅、后 POST(ticket 00 修复的顺序)
    const received: Array<{ kind: string; admission?: unknown; source_refs?: unknown }> = []
    const unsub = hub.subscribe(reqId, (ev: unknown) => {
      const e = ev as { type?: string; chunk?: { kind: string; admission?: unknown; source_refs?: unknown } }
      if (e.type === 'analysis_chunk' && e.chunk) received.push(e.chunk)
    })
    try {
      expect((await postStart(reqId, 'sess-sse')).statusCode).toBe(201)
      await new Promise((r) => setTimeout(r, 400))
    } finally {
      unsub()
    }

    const jsonl = readChunks(reqId, 'sess-sse')
    expect(received).toHaveLength(jsonl.length)
    expect(received.map((c) => c.kind)).toEqual(jsonl.map((c) => c.kind))
    expect(received.filter((c) => c.admission)).toHaveLength(6) // 5 DIM + 1 VERDICT
    expect(received.filter((c) => c.source_refs)).toHaveLength(2)
  })

  it('无标记的自由文本仍落 narration(不丢内容)', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        [
          { type: 'text', text: '我先读一下 PRD。', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-1' },
        ],
        [{ type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-2' }],
      ],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-parse-free'
    seedReq(reqId)
    expect((await postStart(reqId, 'sess-free')).statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 300))

    const chunks = readChunks(reqId, 'sess-free')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].kind).toBe('narration')
    expect(chunks[0].text).toBe('我先读一下 PRD。')
  })
})

describe('start handler:真实错误路径不挂死(audit #3)', () => {
  it('turn-1 send() reject(此后无任何事件)→ turn-2 仍跑出产物', async () => {
    const { provider, captures } = createRecordingProvider({
      eventsByTurn: [
        [], // turn-1 不推任何事件
        [
          { type: 'text', text: TURN2_TEXT, delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-2' },
        ],
      ],
      sendBehaviorByTurn: ['reject', 'ok'],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-err-t1'
    seedReq(reqId)
    expect((await postStart(reqId, 'sess-err-t1')).statusCode).toBe(201)

    // 关键断言:若 pump 挂死,send 永远只会被调 1 次
    await new Promise((r) => setTimeout(r, 500))
    expect(captures.sendCalls).toHaveLength(2)
    const chunks = readChunks(reqId, 'sess-err-t1')
    expect(chunks.map((c) => c.kind)).toEqual(['subproblem', 'risk', 'option'])
  })

  it('turn-1 / turn-2 都 reject → 不挂死,jsonl 为空但流程收敛', async () => {
    const { provider, captures } = createRecordingProvider({
      eventsByTurn: [[], []],
      sendBehaviorByTurn: ['reject', 'reject'],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-err-both'
    seedReq(reqId)
    expect((await postStart(reqId, 'sess-err-both')).statusCode).toBe(201)

    await new Promise((r) => setTimeout(r, 500))
    expect(captures.sendCalls).toHaveLength(2)
    expect(readChunks(reqId, 'sess-err-both')).toHaveLength(0)
  })

  it('error envelope 推流后 send reject(无 done)→ 已产出的 chunk 保留且不挂死', async () => {
    const { provider, captures } = createRecordingProvider({
      eventsByTurn: [
        [
          { type: 'text', text: '[SUBPROBLEM]\ntext: 半成品。\n\n', delta: false },
          {
            type: 'error',
            code: 'rate_limit',
            message: 'rate limited',
            recoverable: false,
            category: 'B',
          },
          // 注意:**没有 done** —— 模拟 SDK 在 error 后直接断流
        ],
        [{ type: 'done', reason: 'end_turn' as const, sessionId: 'sdk-2' }],
      ],
      sendBehaviorByTurn: ['reject-after', 'ok'],
    })
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })
    const reqId = 'req-err-envelope'
    seedReq(reqId)
    expect((await postStart(reqId, 'sess-err-env')).statusCode).toBe(201)

    await new Promise((r) => setTimeout(r, 500))
    expect(captures.sendCalls).toHaveLength(2)
    const chunks = readChunks(reqId, 'sess-err-env')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].kind).toBe('subproblem')
    expect(chunks[0].text).toBe('半成品。')
  })
})
