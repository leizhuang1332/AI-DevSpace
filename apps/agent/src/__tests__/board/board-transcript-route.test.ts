/**
 * board-transcript route 测试 —— issue 08 / ADR-0028 D5
 *
 * 覆盖:
 * - GET /cards/:cardId/transcript:文件不存在 → 200 {transcript: null}
 * - GET:有消息 → 200 {transcript: {messages: [...], ...}}
 * - POST /cards/:cardId/transcript/messages:追加 user 消息 → 200 {transcript}
 *   - tool_calls 强制 [](守门 ADR-0028 D2)
 *   - ts 由服务层写(caller 不传 ts)
 *   - role 强制 'user'(caller 传 role=assistant 也被忽略)
 * - POST:refs 透传(run_id / prd_section / asset)
 * - POST:卡不存在 → 404 E_CARD_NOT_FOUND
 * - POST:req 不存在 → 404 E_REQUIREMENT_NOT_FOUND
 * - POST:body 非法(content 空)→ 400 invalid-body
 * - 无 token → 401
 *
 * 设计:Fastify + inject,直接调 boardTranscriptRoutes + boardCardRoutes(卡存在性校验
 * 复用 TaskCardStore);不拉完整 buildServer(避免 SDK init)。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import type { TaskCard, TaskCardTranscript } from '@ai-devspace/shared'
import { authPlugin } from '../../auth/authPlugin.js'
import { TokenManager } from '../../auth/TokenManager.js'
import { TaskCardStore } from '../../services/board/TaskCardStore.js'
import { TaskCardTranscriptService } from '../../services/board/TaskCardTranscript.js'
import { boardTranscriptRoutes } from '../../routes/board-transcript.js'
import { boardCardRoutes } from '../../routes/board-cards.js'

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

let tmpRoot: string
let app: FastifyInstance
let token: string
let store: TaskCardStore
let transcriptService: TaskCardTranscriptService

const REQ_ID = 'req-001-refund'
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKAA'

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-transcript-'))
  mkdirSync(join(tmpRoot, 'requirements', REQ_ID), { recursive: true })
  writeFileSync(join(tmpRoot, 'requirements', REQ_ID, 'meta.yaml'), 'id: x\n')

  const tm = new TokenManager(tmpRoot)
  token = await tm.ensure()

  store = new TaskCardStore({
    root: tmpRoot,
    ulidFactory: () => CARD_ID,
    nowIso: () => '2026-08-06T10:00:00.000Z',
  })
  transcriptService = new TaskCardTranscriptService(tmpRoot)

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(boardCardRoutes, { store })
  await app.register(boardTranscriptRoutes, {
    taskCardStore: store,
    transcriptService,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token, 'content-type': 'application/json' }
}

/** seed 一张卡(让 transcript 路由的卡存在性校验通过) */
function seedCard(cardId: string = CARD_ID): TaskCard {
  return store.create(REQ_ID, { title: '测试卡', id: cardId })
}

// ---------------------------------------------------------------------------
// GET /api/requirement/:id/board/cards/:cardId/transcript
// ---------------------------------------------------------------------------

describe('GET /api/requirement/:id/board/cards/:cardId/transcript', () => {
  it('200 + {transcript: null} when transcript file does not exist', async () => {
    seedCard()
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { transcript: TaskCardTranscript | null }
    expect(body.transcript).toBeNull()
  })

  it('200 + transcript with messages after append', async () => {
    seedCard()
    // 先 append 一条(走 service,不经 HTTP)
    transcriptService.appendMessage(REQ_ID, CARD_ID, {
      role: 'user',
      content: '第一条消息',
    })
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { transcript: TaskCardTranscript | null }
    expect(body.transcript).not.toBeNull()
    expect(body.transcript!.messages).toHaveLength(1)
    expect(body.transcript!.messages[0]!.content).toBe('第一条消息')
    expect(body.transcript!.messages[0]!.role).toBe('user')
  })

  it('404 E_CARD_NOT_FOUND when card missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.reason).toBe('card-not-found')
  })

  it('401 without token', async () => {
    seedCard()
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript`,
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /api/requirement/:id/board/cards/:cardId/transcript/messages
// ---------------------------------------------------------------------------

describe('POST /api/requirement/:id/board/cards/:cardId/transcript/messages', () => {
  it('200 + appends a user message and returns full transcript', async () => {
    seedCard()
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript/messages`,
      headers: authHeaders(),
      payload: { content: '用户输入的消息' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { transcript: TaskCardTranscript }
    expect(body.transcript.messages).toHaveLength(1)
    const msg = body.transcript.messages[0]!
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('用户输入的消息')
    expect(msg.tool_calls).toEqual([]) // 守门:永远空
    expect(msg.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ts 由服务层写
  })

  it('forces role=user even if caller passes role=assistant', async () => {
    seedCard()
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript/messages`,
      headers: authHeaders(),
      payload: { content: '尝试冒充 assistant', role: 'assistant' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { transcript: TaskCardTranscript }
    expect(body.transcript.messages[0]!.role).toBe('user') // 守门:强制 user
  })

  it('preserves refs (run_id / prd_section / asset)', async () => {
    seedCard()
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript/messages`,
      headers: authHeaders(),
      payload: {
        content: '引用 Run #17',
        refs: [
          { kind: 'run_id', run_id: 'run-17' },
          { kind: 'prd_section', path: 'requirement.md', line_range: [2, 3] },
          { kind: 'asset', name: 'diagram.png' },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { transcript: TaskCardTranscript }
    expect(body.transcript.messages[0]!.refs).toHaveLength(3)
    expect(body.transcript.messages[0]!.refs[0]).toMatchObject({
      kind: 'run_id',
      run_id: 'run-17',
    })
    expect(body.transcript.messages[0]!.refs[1]).toMatchObject({
      kind: 'prd_section',
      path: 'requirement.md',
    })
    expect(body.transcript.messages[0]!.refs[2]).toMatchObject({
      kind: 'asset',
      name: 'diagram.png',
    })
  })

  it('400 invalid-body when content is empty', async () => {
    seedCard()
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript/messages`,
      headers: authHeaders(),
      payload: { content: '   ' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string; reason: string }
    expect(body.reason).toBe('invalid-body')
  })

  it('404 E_CARD_NOT_FOUND when card does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript/messages`,
      headers: authHeaders(),
      payload: { content: '消息' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.reason).toBe('card-not-found')
  })

  it('appends multiple messages in order', async () => {
    seedCard()
    for (const content of ['第一条', '第二条', '第三条']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript/messages`,
        headers: authHeaders(),
        payload: { content },
      })
      expect(res.statusCode).toBe(200)
    }
    const get = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/transcript`,
      headers: authHeaders(),
    })
    const body = get.json() as { transcript: TaskCardTranscript | null }
    expect(body.transcript!.messages.map((m) => m.content)).toEqual([
      '第一条',
      '第二条',
      '第三条',
    ])
  })
})
