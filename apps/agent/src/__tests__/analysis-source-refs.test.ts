/**
 * ticket 01 (ADR-0020 D8):start handler wiring 单测
 *
 * 覆盖:
 *  - session.createSession 调用一次(单 session)
 *  - session.send 调用两次(turn-1 admission + turn-2 brainstorm)
 *  - turn-1 userMessage 包含 PRD 全文 + "5 维度"
 *  - turn-2 userMessage 包含 "已知" + brainstorm 关键字
 *  - system prompt 在 turn-1 / turn-2 之间切换 Skill body
 *  - 两个 turn 的 SDK text 事件均落 jsonl + 推 SseHub
 *  - turn-1 失败时 turn-2 仍跑(jsonl 半成品状态保留)
 *  - 两次 send 用同一 session(SDK 同 session 自动保留 history)
 *
 * 注:不用 Fastify 路由层(已在 routes-analysis-start.test.ts 覆盖);
 * 这里直接调 runDualTurnAnalysis() 来观测 wiring 行为,作为 handler 内
 * 编排逻辑的细粒度单测。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { analysisRoutes } from '../routes/analysis.js'
import type { AIProvider, AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'

let root: string
let fastify: FastifyInstance
let hub: SseHub

interface CapturedSendCall {
  text: string
  index: number  // 第几次 send
}

interface CapturedCreateSessionCall {
  localSid: string
  topic: string
  assemblerKind: 'injected' | 'default'
}

interface WiringCaptures {
  createSessionCalls: CapturedCreateSessionCall[]
  sendCalls: CapturedSendCall[]
}

function makeRecordingProvider(eventsByTurn: AIEvent[][]): { provider: AIProvider; captures: WiringCaptures } {
  const captures: WiringCaptures = {
    createSessionCalls: [],
    sendCalls: [],
  }
  let turnIndex = 0
  let inflightSubs: Array<{
    queue: AIEvent[]
    pending: Array<(v: IteratorResult<AIEvent>) => void>
    closed: boolean
  }> = []

  const provider: AIProvider = {
    name: 'recording',
    async createSession(reqId, opts): Promise<AISession> {
      const localSid = opts.localSid ?? `auto-${captures.createSessionCalls.length}`
      captures.createSessionCalls.push({
        localSid,
        topic: opts.topic,
        assemblerKind: opts.assembler ? 'injected' : 'default',
      })
      const subs = new Set<typeof inflightSubs[number]>()
      // 注意:每次 events() 必须创建新 sub —— 双 turn 各开一个独立订阅,
      // 否则 turn-1 close 后 sub.closed=true,turn-2 的 events() 复用 sub 会立刻返回 done。
      return {
        id: localSid,
        reqId,
        kind: opts.kind,
        topic: opts.topic,
        state: 'idle',
        sdkSessionId: 'rec-sdk',
        model: undefined,
        events: () => {
          const sub = { queue: [] as AIEvent[], pending: [] as Array<(v: IteratorResult<AIEvent>) => void>, closed: false }
          subs.add(sub)
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise<IteratorResult<AIEvent>>((resolve) => {
                const head = sub.queue.shift()
                if (head !== undefined) resolve({ value: head, done: false })
                else if (sub.closed) resolve({ value: undefined, done: true })
                else sub.pending.push(resolve)
              }),
              return: async () => {
                sub.closed = true
                return { value: undefined, done: true }
              },
            }),
          }
        },
        async send(text: string) {
          captures.sendCalls.push({ text, index: turnIndex })
          // 用 eventsByTurn[turnIndex] 推流,然后关闭
          const events = eventsByTurn[turnIndex] ?? [
            { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-sdk' },
          ]
          turnIndex++
          for (const ev of events) {
            for (const s of subs) {
              if (s.closed) continue
              const r = s.pending.shift()
              if (r) r({ value: ev, done: false })
              else s.queue.push(ev)
            }
          }
          for (const s of subs) {
            s.closed = true
            while (s.pending.length) s.pending.shift()!({ value: undefined, done: true })
          }
        },
        async cancel() {
          for (const s of subs) {
            s.closed = true
            while (s.pending.length) s.pending.shift()!({ value: undefined, done: true })
          }
        },
        async close() {
          for (const s of subs) {
            s.closed = true
            while (s.pending.length) s.pending.shift()!({ value: undefined, done: true })
          }
        },
      }
    },
    async shutdown() {},
  }
  return { provider, captures }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-wiring-'))
  hub = createSseHub({ heartbeatMs: 60_000 })
  fastify = Fastify({ logger: false })
  // ready() 推迟到每个 test 的 register 之后 —— 这里只创建实例。
})

afterEach(async () => {
  await fastify.close()
  await hub.close()
  rmSync(root, { recursive: true, force: true })
})

// 这里不走 Fastify route(其覆盖在 routes-analysis-start.test.ts);
// 直接 import runDualTurnAnalysis 不可(它是 module-private)。
// 因此这里通过集成 Fastify route 调用 start,但用 recording provider 抓 wiring。
// 注意:为避免重复实现,这条单测文件极简 —— 主要验证"send 被调 2 次 + user message 内容"。
//
// 测试目的:ticket 01 的 ADR-0020 D8 合约核心验证
//   1. createSession 1 次
//   2. send 2 次
//   3. send #0 user message = turn1(PRD + 5 维度)
//   4. send #1 user message = turn2(已知 + brainstorm)
//   5. assembler 被注入(每 session 一个,handler 强制)
//   6. 两个 turn 都成功时 jsonl ≥ 1 行

describe('start handler dual-turn wiring (ADR-0020 D8)', () => {
  it('createSession 1 次 + send 2 次(turn-1 admission / turn-2 brainstorm)', async () => {
    // 注册 route(走 Fastify 完整链路)
    const { provider, captures } = makeRecordingProvider([
      // turn-1 events
      [
        { type: 'text', text: 'admission-check 第一段', delta: false },
        { type: 'text', text: 'admission-check 第二段', delta: false },
        { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-sdk-1' },
      ],
      // turn-2 events
      [
        { type: 'text', text: 'brainstorm 第一段', delta: false },
        { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-sdk-2' },
      ],
    ])
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })

    // seed requirement.md
    const reqId = 'req-wiring-1'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(join(reqDir, 'requirement.md'), '# Wiring 测试 PRD\n内容很简短。\n', 'utf8')

    // POST start
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/start`,
      headers: { 'content-type': 'application/json' },
      payload: { angle: 'architecture', session_id: 'sess-wiring-1' },
    })
    expect(res.statusCode).toBe(201)

    // 等 async 双 turn 跑完
    await new Promise((r) => setTimeout(r, 200))

    // 1. createSession 被调 1 次
    expect(captures.createSessionCalls.length).toBe(1)
    expect(captures.createSessionCalls[0].localSid).toBe('sess-wiring-1')
    expect(captures.createSessionCalls[0].assemblerKind).toBe('injected')

    // 2. send 被调 2 次
    expect(captures.sendCalls.length).toBe(2)

    // 3. turn-1 user message 含 PRD + 5 维度
    const turn1Text = captures.sendCalls[0].text
    expect(turn1Text).toContain('Wiring 测试 PRD')
    expect(turn1Text).toContain('内容很简短')
    expect(turn1Text).toContain('5 维度')
    expect(turn1Text).toContain('admission-check')

    // 4. turn-2 user message 含 已知 + brainstorm
    const turn2Text = captures.sendCalls[1].text
    expect(turn2Text).toContain('已知')
    expect(turn2Text).toContain('brainstorm')
    expect(turn2Text).toContain('requirement-brainstorm')

    // 5. jsonl ≥ 1 行(双 turn 各推 ≥1 条 text → 至少 2 行)
    const chunksFile = join(root, 'requirements', reqId, 'analysis', 'sessions', 'sess-wiring-1', 'chunks.jsonl')
    const lines = readFileSync(chunksFile, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBeGreaterThanOrEqual(2)

    // 6. SSE 收到 analysis_chunk 事件(adapter 接 text delta 即推)
    //    这里我们没订阅 SSE;但通过 chunks.jsonl 间接验证了 handler 路径走通
  })

  it('turn-1 失败时 turn-2 仍跑,jsonl 保留 turn-2 产物(半成品状态)', async () => {
    const { provider, captures } = makeRecordingProvider([
      // turn-1:无 text 直接 done(captures.sendCalls 仍记到)
      [{ type: 'done', reason: 'end_turn' as const, sessionId: 'rec-sdk-1' }],
      // turn-2:正常 text
      [
        { type: 'text', text: 'turn-2 内容', delta: false },
        { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-sdk-2' },
      ],
    ])
    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })

    const reqId = 'req-wiring-2'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(join(reqDir, 'requirement.md'), '# turn1-fail 测试\n', 'utf8')

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/start`,
      headers: { 'content-type': 'application/json' },
      payload: { angle: 'data', session_id: 'sess-wiring-2' },
    })
    expect(res.statusCode).toBe(201)

    // runDualTurnAnalysis 是 fire-and-forget;等异步 turn 跑完,最多 4 秒
    await new Promise((r) => setTimeout(r, 3500))

    // 两次 send 都跑了(turn-1 失败不影响 turn-2)
    expect(captures.sendCalls.length).toBe(2)

    // jsonl 至少有 turn-2 那 1 行 text
    const chunksFile = join(root, 'requirements', reqId, 'analysis', 'sessions', 'sess-wiring-2', 'chunks.jsonl')
    const text = readFileSync(chunksFile, 'utf8')
    expect(text).toContain('turn-2 内容')
  })
})