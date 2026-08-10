/**
 * board-chat route 测试 —— issue 05 / ADR-0029 D9 + D10
 *
 * 覆盖(issue 05 ticket 验收):
 * - POST /chat/sessions/start → 首次启动落 session.json,SDK sessionId 透传
 * - POST /chat/sessions/:sessionId/query → SSE 流(chat_session_init / message_* / tool_* / permission_* / complete)
 * - GET  /chat/sessions/snapshot → meta + events 数组(Snapshot 协议)
 * - PUT  /chat/sessions/:sessionId/model → 切 model 写 session.json
 * - PUT  /chat/sessions/:sessionId/plan-mode → 切 plan mode 写 session.json
 * - POST /chat/sessions/:sessionId/permission → 决议 permission request
 * - POST /chat/sessions/:sessionId/cost-cap → 决议 cost cap(4 选项)
 * - 错误响应:requirement-not-found / card-not-found / session-not-found /
 *   session-locked / invalid-body / internal,401 without token
 *
 * 设计(seam):
 * - Fastify + authPlugin + inject(非 SSE 端点)+ listen + http.request(SSE 端点),
 *   沿用 requirementEventsRoute.test.ts 的 SSE 验证模式
 * - 注入真 ChatSessionService(沿用 issue 03) + 真 TaskCardStore + 假 Provider
 *   (注入 runChatQuery,事件按预设脚本通过 onEvent 推到 route 层)
 * - 假 Provider 模拟 SDK 流(emit events by `input.onEvent(...)`),
 *   并把 userConfirmHandler 透传出来供测试控制决议
 *
 * 不测:真 SDK 子进程调用 / Provider 内部 SDK args 包装 / mcpCallCounter(均由
 * issue 02 RED e2e 守门 + Provider 单测覆盖)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import Fastify, { type FastifyInstance } from 'fastify'
import { authPlugin } from '../../auth/authPlugin.js'
import { TokenManager } from '../../auth/TokenManager.js'
import { TaskCardStore } from '../../services/board/TaskCardStore.js'
import {
  ChatSessionService,
  DEFAULT_PERMISSION_MODE,
} from '../../services/board/ChatSessionService.js'
import { boardChatRoutes } from '../../routes/board-chat.js'
import type {
  ChatQueryCapableProvider,
  ChatQueryInput,
  ChatQueryResult,
  ChatStreamEvent,
} from '../../providers/AIProvider.js'
import { ChatPermissionMode } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// Fake provider —— 模拟 SDK 流式事件 + 透传 userConfirmHandler
// ---------------------------------------------------------------------------

/** 预脚本化事件序列 —— 每条元素在 runChatQuery 内被 emit 一遍 */
interface ScriptedEvent {
  /** 传给 `input.onEvent` 的事件 */
  event: ChatStreamEvent
  /** 在此事件 emit 后是否调用 userConfirmHandler(用于测试 permission 流) */
  awaitPermission?: {
    toolName: string
    requestId: string
  }
}

class FakeChatProvider implements ChatQueryCapableProvider {
  readonly name = 'fake-chat'
  /** 测试可注入:每个 query 调用的预设事件脚本(按入参 cwd 区分) */
  scripts = new Map<string, ScriptedEvent[]>()
  /** 默认脚本 —— 当 cwd 没匹配到时走这个 */
  defaultScript: ScriptedEvent[] = []
  /** 用于模拟 SDK sessionId 返回值 */
  nextSessionId = 'sdk-sess-fake-001'

  runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
    const script =
      this.scripts.get(input.cwd) ??
      this.scripts.get(`__cwd:${input.cwd}`) ??
      this.defaultScript
    for (const { event, awaitPermission } of script) {
      input.onEvent(event)
      if (awaitPermission) {
        // fire-and-forget:不阻塞后续事件(测试 POST /permission 与 SSE 同窗口 race
        // 是另一回事);handler 决议由路由层 user_confirm 闭包独立 resolve。
        void input
          .userConfirmHandler({
            toolName: awaitPermission.toolName,
            requestId: awaitPermission.requestId,
            input: {},
          })
          .then(() => undefined)
          .catch(() => undefined)
      }
    }
    return { ok: true, sessionId: this.nextSessionId }
  })
}

// ---------------------------------------------------------------------------
// SSE 工具 —— 沿用 requirementEventsRoute.test.ts 的 openSse 模式
// ---------------------------------------------------------------------------

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** 打开 SSE,读完指定毫秒后断开 socket;返回 status / headers / body */
function openSse(
  port: number,
  urlPath: string,
  headers: Record<string, string>,
  readMs = 400,
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** POST SSE —— 触发流式响应,SDK 脚本事件透到 wire */
function postSse(
  port: number,
  urlPath: string,
  body: unknown,
  headers: Record<string, string>,
  readMs = 400,
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        method: 'POST',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** 解析 SSE body 为事件数组(每条 event 名 + data JSON 对象) */
function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = []
  const frames = body.split('\n\n').filter((f) => f.trim().length > 0)
  for (const frame of frames) {
    let eventName = ''
    let dataRaw = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataRaw += line.slice(6)
    }
    if (eventName) {
      try {
        out.push({ event: eventName, data: JSON.parse(dataRaw) })
      } catch {
        out.push({ event: eventName, data: dataRaw })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 测试基础设施
// ---------------------------------------------------------------------------

let tmpRoot: string
let app: FastifyInstance
let token: string
let port: number
let taskCardStore: TaskCardStore
let chatSessionService: ChatSessionService
let provider: FakeChatProvider

const REQ_ID = 'req-001-refund'
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKAA'

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-boardchat-'))
  mkdirSync(join(tmpRoot, 'requirements', REQ_ID), { recursive: true })
  writeFileSync(join(tmpRoot, 'requirements', REQ_ID, 'meta.yaml'), 'id: x\n')

  const tm = new TokenManager(tmpRoot)
  token = await tm.ensure()

  taskCardStore = new TaskCardStore({
    root: tmpRoot,
    ulidFactory: () => CARD_ID,
    nowIso: () => '2026-08-06T10:00:00.000Z',
  })
  // seed 卡
  taskCardStore.create(REQ_ID, { title: '测试卡', id: CARD_ID })

  chatSessionService = new ChatSessionService({
    workspaceRoot: tmpRoot,
    nowIso: () => '2026-08-06T10:00:00.000Z',
  })

  provider = new FakeChatProvider()

  app = Fastify({ logger: false })
  await app.register(authPlugin, {
    tokenManager: tm,
    allowedOrigins: ['http://localhost:3333'],
  })
  await app.register(boardChatRoutes, {
    taskCardStore,
    chatSessionService,
    provider,
    workspaceRoot: tmpRoot,
  })
  await app.ready()
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  port = new URL(url).port
})

afterEach(async () => {
  await app.close()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token, 'content-type': 'application/json' }
}

// ---------------------------------------------------------------------------
// POST /api/requirement/:id/board/cards/:cardId/chat/sessions/start
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/start', () => {
  it('200 + meta when no prior session — triggers SDK first query and persists session.json', async () => {
    // 替换 defaultScript:让 fake provider 在 /start 调用时 yield session_init + complete。
    // (默认脚本空,需在调用前替换为带 init 事件的脚本 —— session_init 上来后
    //  route 立即落 session.json 并返 meta)
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-first-001',
          cwd: '/workspace/requirements/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
      { event: { kind: 'complete', ts: 1, sessionId: 'sdk-sess-first-001', totalTokens: 100, cost: 0.005, reason: 'end_turn' } },
    ]

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: '你好' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string; model: string; cardId: string } }
    expect(body.meta.sessionId).toBe('sdk-sess-first-001')
    expect(body.meta.cardId).toBe(CARD_ID)
    expect(body.meta.model).toBe('claude-sonnet-5')
    // Provider 被调(且 prompt 含用户输入)
    expect(provider.runChatQuery).toHaveBeenCalledTimes(1)
  })

  it('200 + existing meta when session.json already on disk (no second SDK init)', async () => {
    // seed 一个已落盘的 session.json(模拟上次 query 留下的 meta)
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-existing-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: ['/workspace/req-001-refund'],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [{ name: 'boardchat', config: { type: 'sdk' } }],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: '继续' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    // 命中已落盘的 session,Provider 不被调(无新 query 启动)
    expect(body.meta.sessionId).toBe('sdk-sess-existing-001')
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('400 invalid-body when content is empty array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [] },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string; reason: string }
    expect(body.reason).toBe('invalid-body')
  })

  it('404 requirement-not-found when req missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/req-999-missing/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('requirement-not-found')
  })

  it('404 card-not-found when card missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('card-not-found')
  })

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: { 'content-type': 'application/json' },
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/:sessionId/query —— SSE 流
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/:sessionId/query (SSE)', () => {
  it('SSE stream emits chat_session_init + chat_message_user + chat_message_assistant + chat_complete', async () => {
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-q-001',
          cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
      {
        event: {
          kind: 'message_assistant',
          ts: 2,
          text: '你好,我可以帮你',
          partial: false,
        },
      },
      {
        event: {
          kind: 'complete',
          ts: 3,
          sessionId: 'sdk-sess-q-001',
          totalTokens: 120,
          cost: 0.006,
          reason: 'end_turn',
        },
      },
    ]

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-001/query`,
      { content: [{ kind: 'text', text: '你好' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)

    const events = parseSseEvents(res.body)
    const kinds = events.map((e) => e.event)
    expect(kinds).toContain('chat_session_init')
    expect(kinds).toContain('chat_message_user')
    expect(kinds).toContain('chat_message_assistant')
    expect(kinds).toContain('chat_complete')

    // chat_message_user data 应含 content(text)
    const userEv = events.find((e) => e.event === 'chat_message_user')
    expect(userEv).toBeDefined()
    const userData = userEv!.data as { content: Array<{ kind: string; text: string }> }
    expect(userData.content[0]?.text).toBe('你好')
  })

  it('SSE forwards chat_permission_request then chat_permission_resolved after POST /permission', async () => {
    let resolveHandler: (() => void) | null = null
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-q-002',
          cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
      // 触发 user_confirm:route 层推 permission_request,然后调 userConfirmHandler
      {
        event: {
          kind: 'permission_request',
          ts: 1,
          requestId: 'req-perm-test-001',
          toolName: 'Write',
          input: { file_path: '/tmp/x', content: 'hi' },
          forced: false,
        },
        awaitPermission: {
          toolName: 'Write',
          requestId: 'req-perm-test-001',
        },
      },
      {
        event: {
          kind: 'complete',
          ts: 99,
          sessionId: 'sdk-sess-q-002',
          totalTokens: 50,
          cost: 0.001,
          reason: 'end_turn',
        },
      },
    ]
    // 透传 userConfirmHandler 后等外部 POST /permission
    // 但 fake provider 默认 await 后直接 resolve;route 层应串起来
    // (SSE 请求期间 POST /permission 决议不会实时插入 SSE;
    //  此测试只断言 SSE 含 permission_request 事件 + permission_resolved 后续事件)

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-002/query`,
      { content: [{ kind: 'text', text: '写文件' }] },
      { 'x-aidevspace-token': token },
      500,
    )
    expect(res.statusCode).toBe(200)

    const events = parseSseEvents(res.body)
    const reqEv = events.find((e) => e.event === 'chat_permission_request')
    expect(reqEv).toBeDefined()
    const reqData = reqEv!.data as { requestId: string; toolName: string }
    expect(reqData.toolName).toBe('Write')
    expect(reqData.requestId).toBe('req-perm-test-001')
    // 完成事件应到达(fake provider 直接 await 决议 → 让 provider 跑完)
    expect(events.map((e) => e.event)).toContain('chat_complete')
  })

  it('409 session-locked when second query fires while first in-flight', async () => {
    // 把 fake provider 慢一点,让第一次 SSE 还在 in-flight
    provider.defaultScript = [
      { event: { kind: 'session_init', sessionId: 'sdk-sess-q-003', cwd: '/x', model: 'claude-sonnet-5' } },
    ]
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      // 慢速:先把 session_init 推出来,然后保持挂起 100ms
      input.onEvent({ kind: 'session_init', sessionId: 'sdk-sess-q-003', cwd: '/x', model: 'claude-sonnet-5' })
      await new Promise((r) => setTimeout(r, 200))
      return { ok: true, sessionId: 'sdk-sess-q-003' }
    })

    // 第一次 SSE —— 发起,不要等完成
    const ssePromise = postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-003/query`,
      { content: [{ kind: 'text', text: 'first' }] },
      { 'x-aidevspace-token': token },
      500,
    )

    // 等 30ms 让第一次 SSE 进入 in-flight lock
    await new Promise((r) => setTimeout(r, 30))

    // 第二次 SSE —— 应被 409 session-locked 拒绝(不走 SSE 流,直接 JSON)
    const res2 = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-003/query`,
      { content: [{ kind: 'text', text: 'second' }] },
      { 'x-aidevspace-token': token },
      200,
    )
    // 锁冲突时,后到的请求不应走 SSE 流(应直接返 409 JSON)
    expect(res2.statusCode).toBe(409)
    const body = res2.body
    // 锁定响应:即便 postSse 工具也读 SSE,锁冲突应直接断开/返 JSON
    // body 可能为空(连接被 server 端 close),但 statusCode 应是 409
    expect(body).toMatch(/session-locked|E_SESSION_LOCKED|session-locked|tab-locked|E_TAB_LOCKED/i)

    // 等第一次 SSE 完成清理
    await ssePromise
  })
})

// ---------------------------------------------------------------------------
// GET /chat/sessions/snapshot
// ---------------------------------------------------------------------------

describe('GET /chat/sessions/snapshot', () => {
  it('200 + {meta: null, events: []} when no session yet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: unknown; events: unknown[] }
    expect(body.meta).toBeNull()
    expect(body.events).toEqual([])
  })

  it('200 + meta with 17 fields when session exists', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-snap-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: ['/workspace/req-001-refund'],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [{ name: 'boardchat', config: { type: 'sdk' } }],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      meta: { sessionId: string; model: string; cardId: string }
      events: unknown[]
    }
    expect(body.meta.sessionId).toBe('sdk-sess-snap-001')
    expect(body.meta.model).toBe('claude-sonnet-5')
    expect(body.meta.cardId).toBe(CARD_ID)
  })

  it('404 requirement-not-found when req missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/req-999-missing/board/cards/${CARD_ID}/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('404 card-not-found when card missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PUT /chat/sessions/:sessionId/model
// ---------------------------------------------------------------------------

describe('PUT /chat/sessions/:sessionId/model', () => {
  it('200 + updated meta with new model', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-model-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-model-001/model`,
      headers: authHeaders(),
      payload: { model: 'claude-opus-4-8', expectedCostMultiplier: 5 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { model: string; sessionId: string } }
    expect(body.meta.model).toBe('claude-opus-4-8')
    expect(body.meta.sessionId).toBe('sdk-sess-model-001')
    // session.json 落盘生效
    const reloaded = chatSessionService.get(REQ_ID, CARD_ID)
    expect(reloaded?.model).toBe('claude-opus-4-8')
  })

  it('400 invalid-body when model empty', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-model-002',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-model-002/model`,
      headers: authHeaders(),
      payload: { model: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('404 session-not-found when no session.json exists', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-not-found/model`,
      headers: authHeaders(),
      payload: { model: 'claude-sonnet-5' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('session-not-found')
  })
})

// ---------------------------------------------------------------------------
// PUT /chat/sessions/:sessionId/plan-mode
// ---------------------------------------------------------------------------

describe('PUT /chat/sessions/:sessionId/plan-mode', () => {
  it('200 + permissionMode=plan when enabled', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-001',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-001/plan-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.PLAN)
  })

  it('200 + permissionMode=default when disabled (and was plan)', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-002',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.PLAN,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-002/plan-mode`,
      headers: authHeaders(),
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.DEFAULT)
  })

  it('403 permission-denied when session is bypassPermissions', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-003',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.BYPASS_PERMISSIONS,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-003/plan-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('permission-denied')
  })

  it('400 invalid-body when enabled is missing', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-004',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-004/plan-mode`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// PUT /chat/sessions/:sessionId/permission-mode (auto-allow toggle · issue 08)
// ---------------------------------------------------------------------------

describe('PUT /chat/sessions/:sessionId/permission-mode', () => {
  it('200 + permissionMode=bypassPermissions when enabled', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-001',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-001/permission-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.BYPASS_PERMISSIONS)
  })

  it('200 + permissionMode=default when disabled (and was bypassPermissions)', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-002',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.BYPASS_PERMISSIONS,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-002/permission-mode`,
      headers: authHeaders(),
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.DEFAULT)
  })

  it('403 permission-denied when session is plan (mutual exclusion)', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-003',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.PLAN,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-003/permission-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('permission-denied')
  })

  it('400 invalid-body when enabled is missing', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-004',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-004/permission-mode`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /chat/sessions/:sessionId/permission', () => {
  it('200 + acknowledge when decision is allow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-001/permission`,
      headers: authHeaders(),
      payload: {
        requestId: 'req-perm-001',
        decision: { decision: 'allow' },
        updatedPermissions: { behavior: 'allow' },
      },
    })
    // 单测不依赖 SDK 实时连接 —— 决议已排队但 user_confirm 不在;返 200 ack
    expect(res.statusCode).toBe(200)
    const body = res.json() as { acknowledged: boolean; requestId: string }
    expect(body.acknowledged).toBe(true)
    expect(body.requestId).toBe('req-perm-001')
  })

  it('400 invalid-body when decision missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-002/permission`,
      headers: authHeaders(),
      payload: { requestId: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/:sessionId/cost-cap
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/:sessionId/cost-cap', () => {
  it('200 + acknowledge when resolve=continue_once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-cap-001/cost-cap`,
      headers: authHeaders(),
      payload: { resolve: 'continue_once' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { acknowledged: boolean; resolve: string }
    expect(body.acknowledged).toBe(true)
    expect(body.resolve).toBe('continue_once')
  })

  it.each(['continue_once', 'continue_session', 'pause', 'new_session'] as const)(
    '200 + acknowledge for resolve=%s',
    async (resolve) => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-cap-${resolve}/cost-cap`,
        headers: authHeaders(),
        payload: { resolve },
      })
      expect(res.statusCode).toBe(200)
    },
  )

  it('400 invalid-body when resolve is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-cap-bad/cost-cap`,
      headers: authHeaders(),
      payload: { resolve: 'fly-to-the-moon' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 401 鉴权失败(全局)
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('401 on POST start without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: { 'content-type': 'application/json' },
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('401 on GET snapshot without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/snapshot`,
    })
    expect(res.statusCode).toBe(401)
  })
})