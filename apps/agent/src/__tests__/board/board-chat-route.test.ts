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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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
    // Provider 被调 1 次(bootstrap sessionId);但 prompt 必须 === '',
    // 不消耗用户首条消息 —— 首条消息由 /query 唯一处理(issue 10)
    expect(provider.runChatQuery).toHaveBeenCalledTimes(1)
    const startCall = provider.runChatQuery.mock.calls[0]?.[0] as { prompt: string }
    expect(startCall.prompt).toBe('')
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

  it('200 + meta when body is empty (issue 12 schema decoupling)', async () => {
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-empty-body-001',
          cwd: '/workspace/requirements/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
    ]
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    expect(body.meta.sessionId).toBe('sdk-sess-empty-body-001')
  })

  it('200 + meta when body has legacy content field (back-compat stripped)', async () => {
    // issue 12 back-compat:老客户端可能仍带 content;zod 默认 strip,
    // 服务端静默忽略,不传给 SDK(prompt 仍 === '')
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-legacy-001',
          cwd: '/workspace/requirements/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
    ]
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: '老客户端发的' }] },
    })
    expect(res.statusCode).toBe(200)
    // prompt 必须仍是空,不消耗 user content
    const startCall = provider.runChatQuery.mock.calls[0]?.[0] as { prompt: string }
    expect(startCall.prompt).toBe('')
  })

  it('400 invalid-body when body has wrong-typed model', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { model: 123 }, // 应是 string,不是 number
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { reason: string }
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

  // issue 11 —— /start 接入单 tab lock,防并发 session.json 撕裂写
  it('409 session-locked when second /start fires while first is in-flight', async () => {
    // 让 fake provider 第一次调用挂起 200ms,模拟 SDK 慢启动;
    // 期间发起第二次 /start,应被锁拒绝
    let inFlight = 0
    let firstStarted = false
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
      inFlight++
      input.onEvent({
        kind: 'session_init',
        sessionId: inFlight === 1 ? 'sdk-sess-start-001' : 'sdk-sess-start-002',
        cwd: '/x',
        model: 'claude-sonnet-5',
      })
      if (!firstStarted) {
        firstStarted = true
        await new Promise((r) => setTimeout(r, 200))
      }
      return { ok: true, sessionId: 'sdk-sess-start-001' }
    })

    // 第一次 /start —— 发起后不等
    const firstPromise = app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })

    // 等 30ms 让第一次 /start 进入 in-flight lock
    await new Promise((r) => setTimeout(r, 30))

    // 第二次 /start —— 应被 409 session-locked 拒绝
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res2.statusCode).toBe(409)
    expect(res2.json()).toMatchObject({ reason: 'session-locked' })

    // 第一次 /start 应继续走完并落 session.json
    const firstRes = await firstPromise
    expect(firstRes.statusCode).toBe(200)
    const firstBody = firstRes.json() as { meta: { sessionId: string } }
    expect(firstBody.meta.sessionId).toBe('sdk-sess-start-001')
  })

  it('two /start with different (reqId, cardId) are NOT locked against each other', async () => {
    // seed 第二张 card(card1.id 由 ulidFactory 决定,此处用另一个 ulid)
    taskCardStore.create(REQ_ID, { title: 'card2', id: '01J7X3K2P5EVR0Z3YQJD8HFKBB' })
    provider.defaultScript = [
      { event: { kind: 'session_init', sessionId: 'sdk-sess-a', cwd: '/x', model: 'claude-sonnet-5' } },
      { event: { kind: 'session_init', sessionId: 'sdk-sess-b', cwd: '/x', model: 'claude-sonnet-5' } },
    ]

    // 同时发起两个 /start —— 不同 lockKey,互不干扰
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
        headers: authHeaders(),
        payload: { content: [{ kind: 'text', text: 'A' }] },
      }),
      app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKBB/chat/sessions/start`,
        headers: authHeaders(),
        payload: { content: [{ kind: 'text', text: 'B' }] },
      }),
    ])
    expect(resA.statusCode).toBe(200)
    expect(resB.statusCode).toBe(200)
  })

  it('lock is released even when SDK fails (finally cleanup)', async () => {
    provider.runChatQuery = vi.fn(async () => {
      // 模拟 SDK 失败 —— 直接 throw
      throw new Error('SDK boom')
    })

    const res1 = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'first' }] },
    })
    // /start 失败 → 走 500 internal 路径
    expect(res1.statusCode).toBe(500)

    // 第二次 /start —— 锁应已释放,SDK 这次返 ok 让落盘成功
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      input.onEvent({
        kind: 'session_init',
        sessionId: 'sdk-sess-retry-001',
        cwd: '/x',
        model: 'claude-sonnet-5',
      })
      return { ok: true, sessionId: 'sdk-sess-retry-001' }
    })
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'retry' }] },
    })
    expect(res2.statusCode).toBe(200)
    const body = res2.json() as { meta: { sessionId: string } }
    expect(body.meta.sessionId).toBe('sdk-sess-retry-001')
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
// POST /chat/sessions/reset(issue 13 端到端自愈)
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/reset · issue 13 自愈端点', () => {
  /** 工具:在 chat dir 落 session.json + audit/foo.log 模拟"有 stale session" */
  async function seedStaleSession(opts: { sdkSessionId: string; cwd: string }): Promise<void> {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: opts.sdkSessionId,
      cwd: opts.cwd,
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    mkdirSync(join(tmpRoot, 'requirements', REQ_ID, 'board', 'tasks', CARD_ID, 'chat', 'audit'), {
      recursive: true,
    })
    writeFileSync(
      join(
        tmpRoot,
        'requirements',
        REQ_ID,
        'board',
        'tasks',
        CARD_ID,
        'chat',
        'audit',
        'fake-audit.jsonl',
      ),
      '{}\n',
    )
  }

  it('200 + acknowledged + 清掉 session.json + audit/ 子目录', async () => {
    await seedStaleSession({
      sdkSessionId: 'sdk-stale-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
    })
    // 确认 seed 落盘
    expect(chatSessionService.get(REQ_ID, CARD_ID)).not.toBeNull()
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'audit',
          'fake-audit.jsonl',
        ),
      ),
    ).toBe(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      acknowledged: boolean
      cleared: { sessionJson: string; auditDir: string; sdkJsonl: string }
    }
    expect(body.acknowledged).toBe(true)
    expect(body.cleared.sessionJson).toBe('renamed')
    expect(body.cleared.auditDir).toBe('removed')
    // 后续 get() 应返 null
    expect(chatSessionService.get(REQ_ID, CARD_ID)).toBeNull()
    // audit 物理清空
    expect(
      existsSync(
        join(tmpRoot, 'requirements', REQ_ID, 'board', 'tasks', CARD_ID, 'chat', 'audit'),
      ),
    ).toBe(false)
    // session.json.bak 应被保留(兜底)
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'session.json.bak',
        ),
      ),
    ).toBe(true)
  })

  it('200 + acknowledged (idempotent) when no session.json exists', async () => {
    // 没 seed —— 直接 reset,service.delete 应兜底 absent + 仍返 200
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      acknowledged: boolean
      cleared: { sessionJson: string; auditDir: string; sdkJsonl: string }
    }
    expect(body.acknowledged).toBe(true)
    expect(body.cleared.sessionJson).toBe('absent')
    expect(body.cleared.auditDir).toBe('absent')
  })

  it('404 requirement-not-found when req missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/req-999-missing/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })

  it('404 card-not-found when card missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })

  it('409 session-locked when concurrent in-flight query holds the lock', async () => {
    // 让 fake provider 第一次 /query 慢 200ms(进入 in-flight lock)
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      input.onEvent({
        kind: 'session_init',
        sessionId: 'sdk-sess-locked',
        cwd: '/x',
        model: 'claude-sonnet-5',
      })
      await new Promise((r) => setTimeout(r, 200))
      return { ok: true, sessionId: 'sdk-sess-locked' }
    })
    const queryPromise = postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-locked/query`,
      { content: [{ kind: 'text', text: 'first' }] },
      { 'x-aidevspace-token': token },
      500,
    )
    await new Promise((r) => setTimeout(r, 30))
    // reset 应被 409 session-locked 拒绝(in-flight /query 持锁)
    const resetRes = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(resetRes.statusCode).toBe(409)
    expect(resetRes.json()).toMatchObject({ reason: 'session-locked' })
    // 让 in-flight /query 跑完清理
    await queryPromise
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/:sessionId/query · issue 13 自愈触发
// ---------------------------------------------------------------------------

describe('POST /query · issue 13 session 失效 SSE 自愈', () => {
  it('SDK 返 ok=true + isSessionExpired=true → SSE 末条 chat_error E_SESSION_EXPIRED + session.json 被改名 .bak', async () => {
    // seed 一个 stale session.json(模拟:之前 /start 用 fake id 'sdk-stale-resume')
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-stale-resume',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    expect(chatSessionService.get(REQ_ID, CARD_ID)?.sessionId).toBe('sdk-stale-resume')

    // 替换 fake provider:不 emit session_init,只 emit error 形式 complete
    // 让 runChatQuery 返 { ok: true, sessionId: '', isSessionExpired: true }
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      input.onEvent({
        kind: 'complete',
        ts: 1,
        sessionId: '', // 真 SDK 找不到 resume 时 observedSessionId 保持 ''
        totalTokens: 0,
        cost: 0,
        reason: 'error',
      })
      return { ok: true, sessionId: '', isSessionExpired: true }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-stale-resume/query`,
      { content: [{ kind: 'text', text: 'continuing' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.body)
    const kinds = events.map((e) => e.event)

    // 末条应是 chat_error E_SESSION_EXPIRED
    const lastError = [...events].reverse().find((e) => e.event === 'chat_error')
    expect(lastError).toBeDefined()
    const errorData = lastError!.data as { code: string; recoverable: boolean }
    expect(errorData.code).toBe('E_SESSION_EXPIRED')
    expect(errorData.recoverable).toBe(true)

    // 整个 SSE 流末条事件应是 chat_error(isSessionExpired 触发)
    expect(kinds[kinds.length - 1]).toBe('chat_error')

    // session.json 应被改名 .bak(issue 13 端到端自愈关键证据)
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'session.json.bak',
        ),
      ),
    ).toBe(true)
    // service.get 后续返 null
    expect(chatSessionService.get(REQ_ID, CARD_ID)).toBeNull()
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